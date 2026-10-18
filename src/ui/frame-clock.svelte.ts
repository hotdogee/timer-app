/**
 * The shared frame clock: one reactive `now` for every view, advanced by a single animation-frame
 * loop (tech-stack.md › Principles, "One render loop"). The loop runs only while some display
 * changes over time; the app switches it with `setActive`.
 */
import { createTicker, type Clock, type EpochMs, type FrameScheduler } from '../core'
import { appClock } from '../state/app-clock'

/** A clock reading shared by every view, refreshed once per animation frame while active. */
export interface FrameClock {
  /**
   * The latest clock reading. Reactive: advances every frame while active and on {@link bump}.
   * While inactive it keeps its last value, so read it only for displays that change over time, or
   * call `bump()` first.
   */
  readonly now: EpochMs
  /** Starts or stops the frame loop. Idempotent; stop it when no display changes over time. */
  setActive(active: boolean): void
  /**
   * Reads the clock immediately instead of waiting for the next frame. Call it before a user
   * action and use the new `now` for the transition, so the state and every view share one reading.
   */
  bump(): void
}

/** Frames from `requestAnimationFrame`, wrapped: calling it as a method of another object throws. */
const animationFrames: FrameScheduler<number> = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => {
    cancelAnimationFrame(handle)
  },
}

/**
 * Creates an inactive frame clock that reads `clock` once per `scheduler` frame while active.
 * Defaults to the app clock (device time corrected by the server-time offset) and
 * `requestAnimationFrame`.
 */
export function createFrameClock(
  clock: Clock = appClock,
  scheduler: FrameScheduler = animationFrames,
): FrameClock {
  let now = $state(clock())
  const ticker = createTicker({
    scheduler,
    clock,
    onTick: (reading) => {
      now = reading
    },
  })
  return {
    get now() {
      return now
    },
    setActive(active) {
      ticker.setActive(active)
    },
    bump() {
      now = clock()
    },
  }
}

/** The app's one frame clock: app time, advanced by `requestAnimationFrame`. */
export const frameClock = createFrameClock()
