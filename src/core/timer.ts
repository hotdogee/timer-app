/**
 * Timer engine: a pure state machine `idle → running ⇄ paused → ringing → idle`.
 *
 * Time is derived, never counted: a running timer stores when it ends (`endsAt`) and every
 * reading is computed from the `now` the caller passes in. Functions never throw. A transition
 * that does not apply returns the input state by reference, so callers can use `===` to detect
 * "nothing changed". Durations that are NaN, negative or infinite are clamped to 0, and a
 * non-finite `now` never reaches a returned state: transitions that would store it return the
 * input unchanged instead. Spans (durations, time left, readings) saturate at {@link MAX_MS}, so
 * the sums the engine stores never overflow and every returned state is finite, JSON-safe data.
 */

import type { EpochMs, Ms, TimerState } from './types'

/**
 * The longest span the engine stores or reads: 8.64e15 ms, the reach of a JavaScript Date
 * (100,000,000 days). Adding it to any finite timestamp still gives a finite timestamp. Stored
 * data and import files are checked against it ({@link isSpan}).
 */
export const MAX_MS: Ms = 8.64e15

/** Whether `value` is a span as the engine stores it: a finite number from 0 to {@link MAX_MS}. */
export function isSpan(value: unknown): value is Ms {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MS
}

/**
 * A caller's duration made usable: NaN, ±Infinity and ≤ 0 give 0, and finite values saturate at
 * {@link MAX_MS}.
 */
function clampMs(ms: number): Ms {
  return Number.isFinite(ms) ? spanMs(ms) : 0
}

/**
 * A computed span made usable: NaN and ≤ 0 give 0, and longer spans, even one that overflowed to
 * Infinity, saturate at {@link MAX_MS}.
 */
function spanMs(ms: number): Ms {
  return ms > 0 ? Math.min(ms, MAX_MS) : 0
}

/** Clamps a fraction into [0, 1]. */
function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x))
}

/**
 * Creates an idle timer set to `duration` milliseconds.
 * NaN, negative and infinite durations become 0 (a timer that cannot start until it is set), and
 * finite durations longer than {@link MAX_MS} are capped at it.
 */
export function createTimer(duration: Ms): TimerState {
  return { phase: 'idle', duration: clampMs(duration) }
}

/**
 * Starts or resumes the timer at `now`.
 * Idle: runs for the full duration. Paused: resumes with the time that was left, or rings at
 * `now` if nothing was left. Ringing: runs again for the full duration (Restart). A running
 * timer, a zero duration (idle or ringing) and a non-finite `now` return `s` unchanged.
 */
export function start(s: TimerState, now: EpochMs): TimerState {
  if (!Number.isFinite(now)) return s
  switch (s.phase) {
    case 'idle':
    case 'ringing':
      return s.duration > 0
        ? { phase: 'running', duration: s.duration, endsAt: now + s.duration }
        : s
    case 'paused':
      return s.remaining > 0
        ? { phase: 'running', duration: s.duration, endsAt: now + s.remaining }
        : { phase: 'ringing', duration: s.duration, endedAt: now }
    case 'running':
      return s
  }
}

/**
 * Pauses a running timer at `now`, keeping the time left as {@link remaining} reads it.
 * If `now` is at or past `endsAt` the timer has already finished, so it rings from `endsAt`
 * (the same result as {@link settle}). Other phases and a non-finite `now` return `s` unchanged.
 */
export function pause(s: TimerState, now: EpochMs): TimerState {
  if (s.phase !== 'running' || !Number.isFinite(now)) return s
  if (now >= s.endsAt) return { phase: 'ringing', duration: s.duration, endedAt: s.endsAt }
  return { phase: 'paused', duration: s.duration, remaining: spanMs(s.endsAt - now) }
}

/**
 * The Space-bar action: starts an idle timer, pauses a running one, resumes a paused one and
 * dismisses a ringing one. Inherits the no-op cases of {@link start}, {@link pause} and
 * {@link dismiss}.
 */
export function toggle(s: TimerState, now: EpochMs): TimerState {
  switch (s.phase) {
    case 'idle':
    case 'paused':
      return start(s, now)
    case 'running':
      return pause(s, now)
    case 'ringing':
      return dismiss(s)
  }
}

/**
 * Stops the timer and returns it to idle with its configured duration.
 * An idle timer returns `s` unchanged.
 */
export function reset(s: TimerState): TimerState {
  return s.phase === 'idle' ? s : { phase: 'idle', duration: s.duration }
}

/**
 * Silences a ringing timer and returns it to idle with its configured duration.
 * Any other phase returns `s` unchanged.
 */
export function dismiss(s: TimerState): TimerState {
  return s.phase === 'ringing' ? { phase: 'idle', duration: s.duration } : s
}

/**
 * Runs a ringing timer again for its full duration from `now`.
 * Any other phase, a zero duration and a non-finite `now` return `s` unchanged.
 */
export function restart(s: TimerState, now: EpochMs): TimerState {
  return s.phase === 'ringing' ? start(s, now) : s
}

/**
 * Sets a new duration and returns the timer to idle; paused and ringing timers are reset by it
 * (spec › Digit entry). NaN, negative and infinite durations become 0, and durations longer than
 * {@link MAX_MS} are capped at it. A running timer returns `s` unchanged, and so does an idle
 * timer that already has the (clamped) duration.
 */
export function setDuration(s: TimerState, duration: Ms): TimerState {
  const next = clampMs(duration)
  if (s.phase === 'running' || (s.phase === 'idle' && s.duration === next)) return s
  return { phase: 'idle', duration: next }
}

/**
 * Adds `delta` milliseconds (negative subtracts) to the timer: the quick-add chips.
 * Idle: changes the duration, floored at 0. Running: moves the end time and the duration
 * together, so the progress ring rescales; if the new end time is at or before `now` the
 * timer rings from `now`. Paused: changes the duration and the time left, each floored at 0.
 * The duration and the time left saturate at {@link MAX_MS}. Ringing, a zero or non-finite
 * `delta`, a result equal to `s`, and a running timer with a non-finite `now` return `s`
 * unchanged; so a zero `delta` leaves a running timer past its end for {@link settle} to date.
 */
export function addTime(s: TimerState, delta: number, now: EpochMs): TimerState {
  if (delta === 0 || !Number.isFinite(delta)) return s
  switch (s.phase) {
    case 'idle': {
      const duration = clampMs(s.duration + delta)
      return duration === s.duration ? s : { phase: 'idle', duration }
    }
    case 'running': {
      if (!Number.isFinite(now)) return s
      const duration = clampMs(s.duration + delta)
      // Capping the time left like the duration also keeps endsAt finite for any finite delta.
      const endsAt = Math.min(s.endsAt + delta, now + MAX_MS)
      if (endsAt <= now) return { phase: 'ringing', duration, endedAt: now }
      return endsAt === s.endsAt && duration === s.duration
        ? s
        : { phase: 'running', duration, endsAt }
    }
    case 'paused': {
      const duration = clampMs(s.duration + delta)
      const remaining = clampMs(s.remaining + delta)
      return duration === s.duration && remaining === s.remaining
        ? s
        : { phase: 'paused', duration, remaining }
    }
    case 'ringing':
      return s
  }
}

/**
 * Snoozes a ringing timer: it runs for `delta` milliseconds from `now` while keeping its
 * configured duration, so Reset still returns to it. A `delta` longer than {@link MAX_MS} is
 * capped at it. Any other phase, a `delta` that is not a positive finite number, and a
 * non-finite `now` return `s` unchanged.
 */
export function snooze(s: TimerState, delta: Ms, now: EpochMs): TimerState {
  const length = clampMs(delta)
  if (s.phase !== 'ringing' || length === 0 || !Number.isFinite(now)) return s
  return { phase: 'running', duration: s.duration, endsAt: now + length }
}

/**
 * Moves a running timer whose end time has come (`now >= endsAt`) to ringing, dated from
 * `endsAt` so overtime counts from the real end. Called every frame. Anything else returns `s`
 * unchanged, which makes it idempotent.
 */
export function settle(s: TimerState, now: EpochMs): TimerState {
  return s.phase === 'running' && now >= s.endsAt
    ? { phase: 'ringing', duration: s.duration, endedAt: s.endsAt }
    : s
}

/**
 * The time left at `now`, for the countdown display.
 * Idle: the duration. Running: time until `endsAt`, never negative (an unsettled timer past its
 * end reads 0) and capped at {@link MAX_MS}. Paused: the frozen time left. Ringing: 0. Never NaN.
 */
export function remaining(s: TimerState, now: EpochMs): Ms {
  switch (s.phase) {
    case 'idle':
      return s.duration
    case 'running':
      return spanMs(s.endsAt - now)
    case 'paused':
      return s.remaining
    case 'ringing':
      return 0
  }
}

/**
 * How long a ringing timer has been ringing at `now` (the `-0:12` display).
 * 0 for every other phase. Never negative or NaN, even if the clock went backwards, and capped at
 * {@link MAX_MS}.
 */
export function overtime(s: TimerState, now: EpochMs): Ms {
  return s.phase === 'ringing' ? spanMs(now - s.endedAt) : 0
}

/**
 * The elapsed fraction of the duration at `now`, in [0, 1], for the progress ring.
 * Idle: 0. Ringing: 1. Running or paused: `1 - remaining / duration`, clamped into [0, 1]
 * (so a snooze longer than the duration, or a clock that went backwards, reads 0); a zero
 * duration reads 1.
 */
export function progress(s: TimerState, now: EpochMs): number {
  switch (s.phase) {
    case 'idle':
      return 0
    case 'ringing':
      return 1
    case 'running':
    case 'paused':
      return s.duration <= 0 ? 1 : clamp01(1 - remaining(s, now) / s.duration)
  }
}

/**
 * When a running timer will ring, for the end-time label ("🔔 2:47 PM").
 * `null` for every other phase.
 */
export function endTime(s: TimerState): EpochMs | null {
  return s.phase === 'running' ? s.endsAt : null
}

/**
 * Whether the display changes from frame to frame: true while running (countdown) or ringing
 * (overtime), false while idle or paused, so the render loop can stop.
 */
export function needsFrames(s: TimerState): boolean {
  return s.phase === 'running' || s.phase === 'ringing'
}
