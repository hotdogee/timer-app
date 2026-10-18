/**
 * Wakes the app at the next timer deadline even while the tab is hidden (tech-stack.md › Background
 * alarms). The web implementation hands the deadline to a dedicated worker (`wake.worker.ts`) and
 * falls back to a main-thread timeout where workers are unavailable or fail to load. Desktop (M5)
 * will schedule in Rust behind the same interface.
 */
import { systemClock, type Clock, type EpochMs } from '../core'
import { appClock, onClockOffsetChange } from '../state/app-clock'
import {
  WAKE_FIRE,
  createWakeTimer,
  globalTimers,
  type TimerApi,
  type WakeRequest,
} from './wake-timer'

/** Calls the app back when the next deadline passes. */
export interface WakeScheduler {
  /**
   * Arranges for `onFire` to run once the clock reaches `at` (read from the same clock as timer
   * deadlines, e.g. the earliest running `endsAt`), even in a hidden tab. Replaces the previous
   * schedule; `null` cancels. Rescheduling the same `at` only swaps the callback, so calling this
   * on every state change is cheap.
   *
   * `onFire` runs at most once per deadline, never synchronously inside `schedule`, and only once
   * the clock has reached `at`, with one exception: it also runs when the page becomes visible
   * while a deadline is pending, so the app can catch up at once. It should settle state against
   * the current time and schedule the next deadline, which makes the extra call harmless.
   */
  schedule(at: EpochMs | null, onFire: () => void): void
}

/** The web scheduler, with teardown for tests and hot reload. */
export interface WebWakeScheduler extends WakeScheduler {
  /** Cancels the schedule, stops the worker and removes listeners. The scheduler stays usable. */
  dispose(): void
}

/** The parts of a `Worker` the scheduler uses. */
export interface WakeWorkerLike {
  postMessage(message: WakeRequest): void
  addEventListener(
    type: 'message' | 'error',
    listener: (event: { readonly data?: unknown }) => void,
  ): void
  terminate(): void
}

/** The parts of `document` the scheduler uses to notice the page becoming visible. */
export interface VisibilityLike {
  readonly visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

/** Dependencies of {@link createWebWakeScheduler}; every field has a browser default. */
export interface WebWakeSchedulerOptions {
  /**
   * The clock deadlines are given in, and checked against before `onFire`. Defaults to the app
   * clock (device time plus the server-time offset), which timer deadlines are stamped in.
   */
  readonly clock?: Clock
  /**
   * The clock the worker reads (`Date.now` in the worker). Deadlines are converted from `clock` to
   * this clock before they are posted. Defaults to system time.
   */
  readonly deviceClock?: Clock
  /**
   * Subscribes to changes of `clock` against `deviceClock` (a new server-time offset), after which
   * the pending deadline is converted and armed again; returns the unsubscribe. Defaults to the app
   * clock's offset changes; null ignores them.
   */
  readonly clockChanges?: ((listener: () => void) => () => void) | null
  /** Spawns the wake worker, or null to always use a main-thread timeout. */
  readonly createWorker?: (() => WakeWorkerLike) | null
  /** Timers for the main-thread fallback. */
  readonly timers?: TimerApi
  /** Source of `visibilitychange`, or null to ignore visibility. Defaults to `document`. */
  readonly visibility?: VisibilityLike | null
}

/** Spawns `wake.worker.ts`. Vite bundles the worker because of this exact `new Worker(new URL(…))`. */
function spawnWakeWorker(): WakeWorkerLike {
  return new Worker(new URL('./wake.worker.ts', import.meta.url), {
    type: 'module',
    name: 'timer-wake',
  })
}

function defaultWorkerFactory(): (() => WakeWorkerLike) | null {
  return typeof (globalThis as { Worker?: unknown }).Worker === 'function' ? spawnWakeWorker : null
}

function defaultVisibility(): VisibilityLike | null {
  return (globalThis as { document?: VisibilityLike }).document ?? null
}

/** Where a deadline is armed: the worker, or a main-thread timeout. */
interface Backend {
  set(at: EpochMs | null): void
  dispose(): void
}

interface Pending {
  readonly at: EpochMs
  onFire: () => void
}

/** Creates the web wake scheduler. It spawns the worker lazily, at the first deadline. */
export function createWebWakeScheduler(options: WebWakeSchedulerOptions = {}): WebWakeScheduler {
  const clock = options.clock ?? appClock
  const deviceClock = options.deviceClock ?? systemClock
  const clockChanges =
    options.clockChanges === undefined ? onClockOffsetChange : options.clockChanges
  const createWorker =
    options.createWorker === undefined ? defaultWorkerFactory() : options.createWorker
  const timers = options.timers ?? globalTimers
  const visibility = options.visibility === undefined ? defaultVisibility() : options.visibility

  let pending: Pending | null = null
  let backend: Backend | null = null
  let listening = false
  let stopClockChanges: (() => void) | null = null

  /** A deadline from `clock` expressed in `deviceClock` time; exact when they are the same clock. */
  function toDevice(at: EpochMs): EpochMs {
    return clock === deviceClock ? at : deviceClock() + (at - clock())
  }

  /** Called by a backend when the deadline may have passed. */
  function check(): void {
    const current = pending
    if (!current) return
    if (clock() < current.at) {
      // Early (clocks disagree, or the clock was set back): arm again for the rest.
      backend?.set(current.at)
      return
    }
    pending = null
    current.onFire()
  }

  function timerBackend(): Backend {
    const timer = createWakeTimer({ now: clock, timers, onFire: check })
    return {
      set: (at) => {
        timer.set(at)
      },
      dispose: () => {
        timer.set(null)
      },
    }
  }

  function workerBackend(): Backend | null {
    if (!createWorker) return null
    let worker: WakeWorkerLike
    try {
      worker = createWorker()
    } catch {
      // E.g. a content security policy without worker-src: use the main thread.
      return null
    }
    let active = true
    worker.addEventListener('message', (event) => {
      if (active && event.data === WAKE_FIRE) check()
    })
    worker.addEventListener('error', () => {
      // The script failed to load or crashed: switch to the main thread and re-arm there.
      if (!active) return
      active = false
      worker.terminate()
      backend = timerBackend()
      if (pending) backend.set(pending.at)
    })
    return {
      set: (at) => {
        if (active) worker.postMessage({ at: at === null ? null : toDevice(at) })
      },
      dispose: () => {
        active = false
        worker.terminate()
      },
    }
  }

  function onVisibilityChange(): void {
    if (visibility?.visibilityState !== 'visible') return
    const current = pending
    if (!current) return
    if (clock() >= current.at) {
      pending = null
      backend?.set(null)
    } else {
      // Re-sync the armed deadline in case the clock moved while the page was hidden or asleep.
      backend?.set(current.at)
    }
    current.onFire()
  }

  function onClockChange(): void {
    // The deadline is the same app time, but a different device time now: post it again.
    if (pending) backend?.set(pending.at)
  }

  function listen(): void {
    stopClockChanges ??= clockChanges?.(onClockChange) ?? null
    if (listening || !visibility) return
    listening = true
    visibility.addEventListener('visibilitychange', onVisibilityChange)
  }

  return {
    schedule(at, onFire) {
      listen()
      if (at === null || !Number.isFinite(at)) {
        if (!pending) return
        pending = null
        backend?.set(null)
        return
      }
      if (pending?.at === at) {
        pending.onFire = onFire
        return
      }
      pending = { at, onFire }
      backend ??= workerBackend() ?? timerBackend()
      backend.set(at)
    },

    dispose() {
      pending = null
      backend?.dispose()
      backend = null
      if (listening && visibility) {
        visibility.removeEventListener('visibilitychange', onVisibilityChange)
      }
      listening = false
      stopClockChanges?.()
      stopClockChanges = null
    },
  }
}
