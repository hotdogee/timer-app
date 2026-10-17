/**
 * Shared types for the core engine. Everything here is plain data:
 * JSON-serializable, immutable, and safe to store as TinyBase cells later.
 */

/** Milliseconds since the Unix epoch, as read from the app clock (see clock.ts). */
export type EpochMs = number

/** A length of time in milliseconds. Never negative. */
export type Ms = number

/**
 * Timer card state. `duration` is the configured length. It survives pause,
 * ring and reset, so Restart and Reset know what to go back to.
 *
 * Phases: idle → running ⇄ paused → ringing → idle
 */
export type TimerState =
  | { readonly phase: 'idle'; readonly duration: Ms }
  | { readonly phase: 'running'; readonly duration: Ms; readonly endsAt: EpochMs }
  | { readonly phase: 'paused'; readonly duration: Ms; readonly remaining: Ms }
  | { readonly phase: 'ringing'; readonly duration: Ms; readonly endedAt: EpochMs }

export type TimerPhase = TimerState['phase']

/**
 * Stopwatch card state. `accumulated` is the elapsed time from earlier running
 * stretches; while running, elapsed = accumulated + (now - startedAt).
 * `laps` holds the elapsed time at each lap press (cumulative splits).
 *
 * Phases: idle → running ⇄ paused → idle
 */
export type StopwatchState =
  | { readonly phase: 'idle' }
  | {
      readonly phase: 'running'
      readonly startedAt: EpochMs
      readonly accumulated: Ms
      readonly laps: readonly Ms[]
    }
  | { readonly phase: 'paused'; readonly accumulated: Ms; readonly laps: readonly Ms[] }

export type StopwatchPhase = StopwatchState['phase']

/** Display style for durations. See spec.md › Time format. */
export type TimeStyle = 'compact' | 'fixed'

/** Up to six typed digits, most recent last, never starting with '0'. '' means nothing typed. */
export type DigitBuffer = string
