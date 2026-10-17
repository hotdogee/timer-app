import type { Clock } from './clock'
import type { EpochMs } from './types'

/**
 * Minimal frame scheduler interface; the web binds it to requestAnimationFrame, tests to a manual
 * queue or `setTimeout`. The scheduler must call back asynchronously (never inside `request`), as
 * `requestAnimationFrame` does. A synchronous scheduler is not supported: a callback fired inside
 * `request` is ignored as stale, and the loop stalls with `isActive()` true and no ticks.
 *
 * @typeParam H - The handle type, returned by `request` and accepted by `cancel` (a number for
 *   `requestAnimationFrame`). Defaults to `unknown`.
 */
export interface FrameScheduler<H = unknown> {
  /**
   * Schedules `callback` to run once at the next frame and returns a handle for `cancel`. The
   * handle is opaque to the ticker: any value works, including `0`, `null` and `undefined`.
   */
  request(callback: () => void): H
  /**
   * Cancels a frame requested with `request`. The ticker passes back exactly the handle `request`
   * returned. A scheduler that cannot cancel (the frame still fires) is tolerated: the ticker
   * ignores frames it no longer expects.
   */
  cancel(handle: H): void
}

/** A frame loop that calls `onTick` once per frame while active and requests nothing while inactive. */
export interface Ticker {
  /**
   * Start or stop requesting frames. Idempotent: activating an active ticker or deactivating an
   * inactive one does nothing, so at most one frame is ever pending. Safe to call from `onTick`.
   */
  setActive(active: boolean): void
  /**
   * Whether the loop is running. Becomes false after `onTick`, the clock, or the request for the
   * next frame throws.
   */
  isActive(): boolean
}

/** Dependencies of {@link createTicker}; `H` is the scheduler's handle type. */
export interface TickerOptions<H = unknown> {
  /** Schedules frames, e.g. bound to `requestAnimationFrame` / `cancelAnimationFrame`. */
  readonly scheduler: FrameScheduler<H>
  /** Read once per frame; its value is passed to `onTick`. */
  readonly clock: Clock
  /** Called once per frame while active, with the clock reading for that frame. */
  readonly onTick: (now: EpochMs) => void
}

/** The frame the ticker is waiting for. `token` identifies it so stale callbacks can be ignored. */
interface PendingFrame<H> {
  readonly token: object
  readonly handle: H
}

/**
 * Creates an inactive frame loop. `setActive(true)` requests one frame; each frame calls
 * `onTick(clock())` and then requests the next one while still active. `setActive(false)` cancels
 * the pending frame, and no further `onTick` runs even if the scheduler fires a frame that was
 * already queued (or one it failed to cancel).
 *
 * If `onTick`, the clock or `scheduler.request` throws during a frame, the loop stops
 * (`isActive()` turns false, any pending frame is cancelled) and the error is rethrown unchanged,
 * so the ticker never gets stuck and can be activated again. If `scheduler.request` throws inside
 * `setActive(true)`, the error propagates and the ticker stays inactive.
 */
export function createTicker<H>(options: TickerOptions<H>): Ticker {
  const { scheduler, clock, onTick } = options
  let active = false
  // Invariant outside a running frame: `pending !== null` exactly when `active`.
  let pending: PendingFrame<H> | null = null

  function requestFrame(): void {
    const token = {}
    const handle = scheduler.request(() => {
      runFrame(token)
    })
    pending = { token, handle }
  }

  function stop(): void {
    active = false
    if (pending === null) return
    const { handle } = pending
    pending = null
    scheduler.cancel(handle)
  }

  function runFrame(token: object): void {
    // A frame that was cancelled, superseded by a newer request, or already run is ignored.
    if (pending?.token !== token) return
    pending = null
    try {
      onTick(clock())
      // onTick may have deactivated the ticker, or deactivated and reactivated it (which already
      // requested a frame); only continue the loop if it is still active with nothing pending.
      if (active && pending === null) requestFrame()
    } catch (error) {
      stop()
      throw error
    }
  }

  return {
    setActive(next) {
      if (next === active) return
      if (next) {
        requestFrame()
        active = true
      } else {
        stop()
      }
    },
    isActive() {
      return active
    },
  }
}
