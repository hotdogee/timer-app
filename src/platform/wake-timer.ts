/**
 * One-shot deadline timer and the wake worker's message protocol. The same timer runs inside
 * `wake.worker.ts` (where hidden-tab throttling does not delay it) and, when workers are
 * unavailable, on the main thread (see `wake.ts`). This module has no runtime imports, so the
 * worker bundle stays tiny.
 */
import type { Clock, EpochMs } from '../core'

/** Message from the page to the wake worker: the deadline in the worker's clock, or null to cancel. */
export interface WakeRequest {
  readonly at: EpochMs | null
}

/** Message from the wake worker to the page: the deadline has passed. */
export const WAKE_FIRE = 'fire'

/** The largest delay `setTimeout` honors (2^31 - 1 ms, about 24.8 days); longer ones fire at once. */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** `setTimeout` and `clearTimeout`, injectable for tests. Handles are opaque. */
export interface TimerApi {
  setTimeout(callback: () => void, delay: number): unknown
  clearTimeout(handle: unknown): void
}

/** The global timer functions, looked up on every call so test fakes installed later apply. */
export const globalTimers: TimerApi = {
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

/** A timer that calls back once its clock reaches the deadline. */
export interface WakeTimer {
  /**
   * Sets the deadline, replacing the previous one; null (or a non-finite value) cancels. A
   * deadline at or before now fires on the next turn of the event loop, never synchronously.
   */
  set(at: EpochMs | null): void
  /** The pending deadline, or null. */
  readonly at: EpochMs | null
}

/** Dependencies of {@link createWakeTimer}. */
export interface WakeTimerOptions {
  /** The clock deadlines are read against. Defaults to `Date.now`. */
  readonly now?: Clock
  readonly timers?: TimerApi
  /** Called once per deadline, after the clock has reached it. */
  readonly onFire: () => void
}

/**
 * Creates an idle {@link WakeTimer}. It keeps at most one `setTimeout` pending. A timeout that fires
 * before the clock reaches the deadline (timers can run a little early, the clock can be set back,
 * and delays beyond {@link MAX_TIMEOUT_MS} are split) re-arms for the rest instead of firing.
 */
export function createWakeTimer(options: WakeTimerOptions): WakeTimer {
  const { onFire } = options
  const now = options.now ?? (() => Date.now())
  const timers = options.timers ?? globalTimers
  let deadline: EpochMs | null = null
  let handle: unknown = null
  let armed = false

  function disarm(): void {
    if (!armed) return
    armed = false
    timers.clearTimeout(handle)
    handle = null
  }

  function arm(target: EpochMs): void {
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, target - now()))
    armed = true
    handle = timers.setTimeout(check, delay)
  }

  function check(): void {
    armed = false
    handle = null
    const target = deadline
    if (target === null) return
    if (now() < target) {
      arm(target)
      return
    }
    deadline = null
    onFire()
  }

  return {
    set(at) {
      disarm()
      deadline = at !== null && Number.isFinite(at) ? at : null
      if (deadline !== null) arm(deadline)
    },
    get at() {
      return deadline
    },
  }
}

/**
 * Reads a {@link WakeRequest}: the deadline, null to cancel, or undefined when `data` is not a
 * well-formed request (which the worker ignores).
 */
export function parseWakeRequest(data: unknown): EpochMs | null | undefined {
  if (typeof data !== 'object' || data === null || !('at' in data)) return undefined
  const { at } = data
  if (at === null) return null
  return typeof at === 'number' && Number.isFinite(at) ? at : undefined
}

/** The parts of a dedicated worker's global scope the wake worker uses. */
export interface WakeWorkerScope {
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void
  postMessage(message: typeof WAKE_FIRE): void
}

/**
 * The wake worker's logic: keeps one {@link WakeTimer} set to the latest requested deadline and
 * posts {@link WAKE_FIRE} when it passes. `wake.worker.ts` calls this with its global scope.
 */
export function connectWakeWorker(
  scope: WakeWorkerScope,
  options: Omit<WakeTimerOptions, 'onFire'> = {},
): WakeTimer {
  const timer = createWakeTimer({
    ...options,
    onFire: () => {
      scope.postMessage(WAKE_FIRE)
    },
  })
  scope.addEventListener('message', (event) => {
    const at = parseWakeRequest(event.data)
    if (at !== undefined) timer.set(at)
  })
  return timer
}
