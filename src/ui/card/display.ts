/**
 * Pure helpers for what a card shows: which face a timer card renders and what its digits read
 * (in the time style setting, with or without overtime), the quick-add chips, the overtime text,
 * the end time's locale and hour cycle, and the stopwatch dot. Kept out of the components so they
 * are unit-tested.
 */
import {
  digits,
  formatCountdown,
  formatOvertime,
  settings,
  type cards,
  type DigitBuffer,
  type Ms,
  type TimerState,
  type TimeStyle,
} from '../../core'
import { m, matchLanguage, type Locale } from '../../i18n'

const PHASE_WORDS: Readonly<Record<TimerState['phase'], () => string>> = {
  idle: m.card_phase_idle,
  running: m.card_phase_running,
  paused: m.card_phase_paused,
  ringing: m.card_phase_ringing,
}

/**
 * A card's kind and state as a screen reader hears them after its name ("Timer, running"), in the
 * active locale; the card's description adds the time from its readout.
 */
export function cardStatus(card: cards.Card): string {
  const phase = card.kind === 'timer' ? card.timer.phase : card.stopwatch.phase
  return m.card_status({
    kind: card.kind === 'timer' ? m.card_kind_timer() : m.card_kind_stopwatch(),
    phase: PHASE_WORDS[phase](),
  })
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

/**
 * A quick-add chip's text: `+0:30`. Always compact, whatever the time style: a chip is an amount
 * to add, and three `+00:00:30` chips would not fit a phone card.
 */
export function quickAddLabel(ms: Ms): string {
  return `+${formatCountdown(ms)}`
}

/**
 * U+2212 MINUS SIGN. The ASCII hyphen-minus is narrower than a tabular digit and sits low; the
 * minus sign has the digits' width and the plus sign's height (tech-stack.md › Core API notes).
 */
export const MINUS = '−'

/**
 * Overtime as the card shows it: `formatOvertime` with a real minus sign (`−0:12`, fixed
 * `−00:00:12`).
 */
export function overtimeText(ms: Ms, style: TimeStyle = 'compact'): string {
  const text = formatOvertime(ms, style)
  return text.startsWith('-') ? MINUS + text.slice(1) : text
}

/** The settings that change what a timer's digits read. */
export interface ReadoutOptions {
  /** Compact (`4:53`) or fixed (`00:04:53`). */
  readonly style: TimeStyle
  /** Whether a ringing timer counts up (`−0:12`) or stays at `0:00`. */
  readonly showOvertime: boolean
}

/**
 * What a timer card's digits read in `view`: the typed digits as typed, the overtime while
 * ringing (or a steady zero without the overtime counter), otherwise the time left. `remaining`
 * and `overtime` are whole seconds in milliseconds, as the card rounds them.
 */
export function timerReadout(
  view: TimerView,
  typed: DigitBuffer,
  remaining: Ms,
  overtime: Ms,
  { style, showOvertime }: ReadoutOptions,
): string {
  if (view === 'typing') return digits.formatTyped(typed)
  if (view !== 'ringing') return formatCountdown(remaining, style)
  return showOvertime ? overtimeText(overtime, style) : formatCountdown(0, style)
}

/** The 12- or 24-hour clock of locale `tag`, or `undefined` when `Intl` cannot tell. */
function hourCycleOf(tag: string | undefined): 'h12' | 'h23' | undefined {
  if (tag === undefined) return undefined
  try {
    const cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle
    if (cycle === 'h11' || cycle === 'h12') return 'h12'
    if (cycle === 'h23' || cycle === 'h24') return 'h23'
  } catch {
    // Not a valid tag: no opinion.
  }
  return undefined
}

/**
 * The locale for clock times (the end-time chip) in UI language `locale`: the first browser
 * language that is a variant of it, so an `en-GB` browser keeps its 24-hour clock in English.
 * When there is none (a `de-DE` browser gets the English UI), the UI language with the hour cycle
 * of the first browser language (`en-u-hc-h23`), since the clock convention is the user's, not
 * the UI's (spec › Time format). Else the UI language itself. The 12/24-hour setting overrides
 * the cycle either way.
 */
export function clockLocale(locale: Locale, languages: readonly string[]): string {
  const variant = languages.find((tag) => matchLanguage(tag) === locale)
  if (variant !== undefined) return variant
  const cycle = hourCycleOf(languages[0])
  return cycle === undefined ? locale : `${locale}-u-hc-${cycle}`
}

/** The hour cycle setting as `formatClockTime` takes it: `'auto'` leaves it to the locale. */
export function clockHourCycle(hourCycle: settings.HourCycle): 'h12' | 'h23' | undefined {
  return hourCycle === 'h12' || hourCycle === 'h23' ? hourCycle : undefined
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
