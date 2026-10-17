import type { EpochMs } from './types'

/**
 * A source of the current time in epoch milliseconds. The engine never reads the time itself;
 * callers read a clock and pass `now` in, so tests can use any fixed or scripted clock.
 */
export type Clock = () => EpochMs

/**
 * The device clock, `Date.now()`. This is the only place in `src/core` that reads real time.
 * Device clocks can jump (sleep, manual changes, NTP), so engine functions tolerate `now` going backwards.
 */
export const systemClock: Clock = () => Date.now()

/**
 * Returns a clock that reads `base` and adds `offsetMs`, e.g. to correct device skew with a
 * server-time offset. `base` is read on every call, never cached. The offset is rounded to whole
 * milliseconds, so `(now + d) - now` stays exactly `d` and a countdown rounded up to the second
 * never reads one second too many on its first frame. A non-finite offset (NaN, ±Infinity) is
 * treated as 0, so a bad offset cannot corrupt every timestamp.
 */
export function offsetClock(base: Clock, offsetMs: number): Clock {
  const offset = Number.isFinite(offsetMs) ? Math.round(offsetMs) : 0
  return () => base() + offset
}
