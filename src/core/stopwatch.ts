/**
 * Stopwatch engine: a pure state machine `idle → running ⇄ paused → idle` with laps.
 *
 * Time is derived, never counted: a running stopwatch stores when the current stretch started
 * plus the time accumulated by earlier stretches, and every reading is computed from `now`.
 * Functions never throw. A transition that does not apply returns the input state by reference,
 * so callers can use `===` to detect "nothing changed".
 */

import type { EpochMs, Ms, StopwatchState } from './types'

/** A running stretch measured from a clock reading; backwards or non-finite readings count as 0. */
function stretch(startedAt: EpochMs, now: EpochMs): Ms {
  const ms = now - startedAt
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** The most recent cumulative split, or 0 when no lap has been recorded. */
function lastSplit(laps: readonly Ms[]): Ms {
  return laps.at(-1) ?? 0
}

/**
 * Creates a stopwatch in the idle phase, reading `0.00`.
 * Returns a new object on every call.
 */
export function createStopwatch(): StopwatchState {
  return { phase: 'idle' }
}

/**
 * Starts or resumes the stopwatch at `now`.
 * From idle it starts from zero with no laps; from paused it resumes, keeping the accumulated
 * time and laps. Running, or a non-finite `now`, returns `s` unchanged.
 */
export function start(s: StopwatchState, now: EpochMs): StopwatchState {
  if (!Number.isFinite(now)) return s
  switch (s.phase) {
    case 'idle':
      return { phase: 'running', startedAt: now, accumulated: 0, laps: [] }
    case 'paused':
      return { phase: 'running', startedAt: now, accumulated: s.accumulated, laps: s.laps }
    case 'running':
      return s
  }
}

/**
 * Pauses a running stopwatch at `now`, freezing its elapsed time and keeping its laps.
 * A clock reading earlier than the start of the current stretch adds nothing, so the frozen time
 * never drops below the time accumulated before this stretch. It can still be lower than the last
 * recorded split after the clock jumped backwards: that stays frozen while paused, and after
 * resuming `currentLap` reads 0 until the total catches up. Idle, paused, or a non-finite `now`
 * returns `s` unchanged.
 */
export function pause(s: StopwatchState, now: EpochMs): StopwatchState {
  if (s.phase !== 'running' || !Number.isFinite(now)) return s
  return { phase: 'paused', accumulated: elapsed(s, now), laps: s.laps }
}

/**
 * Starts or pauses, the Space bar action: idle and paused start, running pauses.
 * A non-finite `now` returns `s` unchanged.
 */
export function toggle(s: StopwatchState, now: EpochMs): StopwatchState {
  return s.phase === 'running' ? pause(s, now) : start(s, now)
}

/**
 * Resets the stopwatch to idle, clearing elapsed time and laps.
 * Idle returns `s` unchanged.
 */
export function reset(s: StopwatchState): StopwatchState {
  return s.phase === 'idle' ? s : { phase: 'idle' }
}

/**
 * Records a lap on a running stopwatch by appending the elapsed time at `now` as a cumulative split.
 * Splits never decrease: if the clock went backwards below the previous split, the previous split
 * is recorded again (a 0 ms lap). Idle, paused, or a non-finite `now` returns `s` unchanged.
 */
export function lap(s: StopwatchState, now: EpochMs): StopwatchState {
  if (s.phase !== 'running' || !Number.isFinite(now)) return s
  const split = Math.max(elapsed(s, now), lastSplit(s.laps))
  return { ...s, laps: [...s.laps, split] }
}

/**
 * Total elapsed time at `now`.
 * Idle is 0 and paused is the frozen accumulated time. Running adds the current stretch, which
 * counts as 0 when `now` is before `startedAt` (clock went backwards) or non-finite.
 * After the clock jumps backwards, the reading can be lower than the last recorded split, also
 * once paused; `currentLap` reads 0 until it catches up. This is deliberate: elapsed stays the sum
 * of the running stretches, with or without laps, rather than a high-water mark.
 */
export function elapsed(s: StopwatchState, now: EpochMs): Ms {
  switch (s.phase) {
    case 'idle':
      return 0
    case 'running':
      return s.accumulated + stretch(s.startedAt, now)
    case 'paused':
      return s.accumulated
  }
}

/**
 * Length of each recorded lap, oldest first: each split minus the previous one (the first lap
 * is its own split). The result always sums to the last split.
 * Idle, or no laps yet, returns a new empty array.
 */
export function lapDurations(s: StopwatchState): readonly Ms[] {
  if (s.phase === 'idle') return []
  return s.laps.map((split, i, splits) => split - (splits[i - 1] ?? 0))
}

/** One recorded lap as a laps list shows it. */
export interface LapRow {
  /** 1 for the first lap. */
  readonly lap: number
  /** Length of this lap. */
  readonly duration: Ms
  /** Total elapsed time when the lap was recorded. */
  readonly split: Ms
}

/**
 * The recorded laps, newest first, each with its number, its length ({@link lapDurations}) and
 * its split. Idle, or no laps yet, returns a new empty array.
 */
export function lapRows(s: StopwatchState): readonly LapRow[] {
  if (s.phase === 'idle') return []
  const durations = lapDurations(s)
  const rows: LapRow[] = []
  for (let i = s.laps.length - 1; i >= 0; i--) {
    rows.push({ lap: i + 1, duration: durations[i] ?? 0, split: s.laps[i] ?? 0 })
  }
  return rows
}

/**
 * Time in the lap in progress at `now`: elapsed time minus the last split (or all of the elapsed
 * time before the first lap). Idle is 0.
 * Never negative: after the clock went backwards, elapsed can be below the last split, whether
 * running or frozen by a pause, and this reads 0 until elapsed catches up.
 */
export function currentLap(s: StopwatchState, now: EpochMs): Ms {
  if (s.phase === 'idle') return 0
  return Math.max(0, elapsed(s, now) - lastSplit(s.laps))
}

/**
 * Whether the display changes over time and needs animation frames: true only while running.
 */
export function needsFrames(s: StopwatchState): boolean {
  return s.phase === 'running'
}
