/**
 * The app's clock (spec › Sync › Clock skew): the device clock plus the server-time offset, so
 * every signed-in device reads the same time and shows the same remaining time for a synced timer.
 * Signed out, the offset is 0 and the app clock is the device clock.
 *
 * Everything that stamps or reads app state (the frame clock, the card store's `createdAt`, the
 * alarm's auto-stop, the wake scheduler's deadlines, startup's settle) reads {@link appClock}.
 * `src/sync/time.ts` measures the offset against the server and sets it here. The device clock
 * itself (`systemClock`) stays for the few places that need it: measuring the offset, and the wake
 * worker, which converts app-time deadlines back to device time.
 *
 * Not reactive on purpose: readers poll it (the frame loop reads it every frame); a change of
 * offset only shifts what the next reading returns. Code that has armed something against an
 * app-time deadline (the wake scheduler) follows {@link onClockOffsetChange} to re-arm.
 */
import { offsetClock, systemClock, type Clock, type Ms } from '../core'

let offset: Ms = 0
let shifted: Clock = systemClock
const listeners = new Set<() => void>()

/** The current app time: device time plus {@link clockOffset}. Reads the device clock each call. */
export const appClock: Clock = () => shifted()

/** The offset in use, in whole milliseconds: app time minus device time. 0 when signed out. */
export function clockOffset(): Ms {
  return offset
}

/**
 * Sets the offset (rounded to whole milliseconds, as `offsetClock` does; a non-finite value counts
 * as 0) and tells the {@link onClockOffsetChange} listeners when it changed.
 */
export function setClockOffset(ms: Ms): void {
  // `|| 0` folds the -0 that rounding a tiny negative offset gives into 0.
  const next = (Number.isFinite(ms) ? Math.round(ms) : 0) || 0
  if (next === offset) return
  offset = next
  shifted = offset === 0 ? systemClock : offsetClock(systemClock, offset)
  for (const listener of [...listeners]) listener()
}

/**
 * Calls `listener` after every change of the offset, until the returned function is called. The
 * listener runs synchronously inside {@link setClockOffset}; {@link appClock} already reads the new
 * offset then.
 */
export function onClockOffsetChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
