/**
 * Duration entry for settings fields (quick-add chips, preset durations), typed like a card
 * (spec › Digit entry): digits shift in from the right into `HH:MM:SS`, Backspace removes the last
 * one, and the field shows exactly what was typed (`00:00:90`) until it is committed, when the
 * overflow normalizes (`90` seconds is 1:30). Pure.
 */
import { digits, formatCountdown, type DigitBuffer, type Ms, type TimeStyle } from '../../core'

/** The bounds a duration field accepts, in milliseconds, inclusive. */
export interface DurationRange {
  readonly min: Ms
  readonly max: Ms
}

const SECOND: Ms = 1000
const MINUTE: Ms = 60 * SECOND
const HOUR: Ms = 60 * MINUTE

/** Preset durations: one second to 99:59:59, the longest a typed duration shows in its fields. */
export const PRESET_RANGE: DurationRange = Object.freeze({ min: SECOND, max: 100 * HOUR - SECOND })

/**
 * The digit buffer that typing the digits of `text` in order gives, skipping every other
 * character: what a field showing `text` holds after an edit. `'00:01:305'` (a 5 typed after
 * `00:01:30`) is `'1305'`, `'00:01:3'` (a Backspace) is `'13'`, and a seventh digit is ignored.
 */
export function bufferFromText(text: string): DigitBuffer {
  let buffer: DigitBuffer = digits.EMPTY
  if (typeof text !== 'string') return buffer
  for (const char of text) buffer = digits.pushDigit(buffer, char)
  return buffer
}

/**
 * The buffer that types `duration` as `HH:MM:SS` (whole seconds, rounded down): 3:00 is `'300'`,
 * 1:30:00 is `'13000'`. Empty for zero, for anything that is not a finite non-negative duration,
 * and for 100 hours or more, which six digits cannot show.
 */
export function bufferFromDuration(duration: Ms): DigitBuffer {
  if (!Number.isFinite(duration) || duration < 0 || duration >= 100 * HOUR) return digits.EMPTY
  const total = Math.floor(duration / SECOND)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return bufferFromText(`${pad(hours)}${pad(minutes)}${pad(seconds)}`)
}

/** What a field shows while editing: the buffer as typed, `HH:MM:SS`. */
export function typedText(buffer: DigitBuffer): string {
  return digits.formatTyped(buffer)
}

/** The duration a buffer commits to, overflow normalized (`'90'` is 90 s). */
export function bufferDuration(buffer: DigitBuffer): Ms {
  return digits.toDurationMs(buffer)
}

/** Whether `duration` lies in `range`. */
export function inRange(duration: Ms, range: DurationRange): boolean {
  return Number.isFinite(duration) && duration >= range.min && duration <= range.max
}

/** A duration as the app shows it: `formatCountdown` in the user's time style (`3:00`). */
export function durationText(duration: Ms, style: TimeStyle): string {
  return formatCountdown(duration, style)
}
