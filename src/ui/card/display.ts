/**
 * Pure helpers for what a card shows: which face a timer card renders, the quick-add chips, the
 * overtime text and the stopwatch dot. Kept out of the components so they are unit-tested.
 */
import {
  digits,
  formatCountdown,
  formatOvertime,
  type cards,
  type DigitBuffer,
  type Ms,
  type TimerState,
} from '../../core'

const PHASE_WORDS: Readonly<Record<string, string>> = {
  idle: 'ready',
  running: 'running',
  paused: 'paused',
  ringing: "time's up",
}

/**
 * A card's kind and state as a screen reader hears them after its name ("Timer, running"); the
 * card's description adds the time from its readout.
 */
export function cardStatus(card: cards.Card): string {
  const phase = card.kind === 'timer' ? card.timer.phase : card.stopwatch.phase
  return `${card.kind === 'timer' ? 'Timer' : 'Stopwatch'}, ${PHASE_WORDS[phase] ?? phase}`
}

/** What a timer card shows: its phase, or `'typing'` while digits are typed for it. */
export type TimerView = 'typing' | TimerState['phase']

/**
 * The face a timer card renders. Typed digits win over the phase (they replace the duration of a
 * paused or ringing timer when applied, spec › Digit entry), except on a running timer, which
 * ignores digits.
 */
export function timerView(t: TimerState, typed: DigitBuffer): TimerView {
  return t.phase !== 'running' && !digits.isEmpty(typed) ? 'typing' : t.phase
}

/** The quick-add chip amounts, in order (spec › Timer: `+0:30` `+1:00` `+5:00`). */
export const QUICK_ADD: readonly Ms[] = Object.freeze([30_000, 60_000, 5 * 60_000])

/** A quick-add chip's text: `+0:30`. */
export function quickAddLabel(ms: Ms): string {
  return `+${formatCountdown(ms)}`
}

/**
 * U+2212 MINUS SIGN. The ASCII hyphen-minus is narrower than a tabular digit and sits low; the
 * minus sign has the digits' width and the plus sign's height (tech-stack.md › Core API notes).
 */
export const MINUS = '−'

/** Overtime as the card shows it: `formatOvertime` with a real minus sign (`−0:12`). */
export function overtimeText(ms: Ms): string {
  const text = formatOvertime(ms)
  return text.startsWith('-') ? MINUS + text.slice(1) : text
}

/** One stopwatch dot revolution, like a second hand (Design decisions › Stopwatch). */
export const DOT_PERIOD: Ms = 60_000

/** Where the stopwatch dot is after `elapsed`: a fraction of a turn clockwise from 12 o'clock. */
export function dotTurn(elapsed: Ms): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0
  return (elapsed % DOT_PERIOD) / DOT_PERIOD
}

/**
 * Whether the ring's progress moved backwards by more than a hair, as it does on Restart or when
 * a chip extends a running timer. The ring animates those jumps; forward motion is per frame and
 * never animated.
 */
export function isRewind(previous: number, next: number): boolean {
  return next < previous - 0.001
}
