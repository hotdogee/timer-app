/**
 * Keyboard digit entry for timer durations (spec.md › Digit entry). Digits shift in from the right
 * into `HH:MM:SS`; the display shows exactly what was typed (`00:00:90`), and the duration
 * normalizes overflow (`90` seconds → 1:30) only when it is read as milliseconds.
 *
 * Every function is pure and total. Valid buffers, the contract's domain, behave exactly as each
 * function documents. Any other string never makes a function throw. A run of ASCII digits reads
 * the way typing those digits would: leading zeros are dropped and only the first
 * {@link MAX_DIGITS} significant digits count, so `'000090'` (what {@link formatTyped} shows, minus
 * the colons) and `'0000090'` read as `'90'`, and `'1234567'` reads as `'123456'`. A string with
 * any other character, or a non-string from untyped code, reads as {@link EMPTY}. {@link pushDigit}
 * and {@link popDigit} return that reading, so `===` against their input detects a no-op only for
 * a valid buffer.
 */

import type { DigitBuffer, Ms } from './types'

/** The most digits a buffer holds: two each for hours, minutes and seconds. */
export const MAX_DIGITS = 6

/** The buffer before anything is typed. It reads as `00:00:00` and a duration of 0. */
export const EMPTY: DigitBuffer = ''

/**
 * Hours, minutes and seconds exactly as typed, before normalization. Each field is a whole number
 * from 0 to 99 and may exceed its clock range, e.g. `'90'` has 90 seconds.
 */
export interface DigitFields {
  readonly hours: number
  readonly minutes: number
  readonly seconds: number
}

/** Zero or more ASCII digits. Locale digits such as Arabic-Indic `'١'` are deliberately excluded. */
const ASCII_DIGITS = /^[0-9]*$/

/** Exactly one ASCII digit, i.e. what `KeyboardEvent.key` reports for a digit or numpad key. */
const SINGLE_DIGIT = /^[0-9]$/

const LEADING_ZEROS = /^0+/

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600

/**
 * Returns the valid buffer that `buf` reads as: `buf` itself when valid; for any other run of ASCII
 * digits, what typing those digits key by key gives (the digits after its leading zeros, cut to the
 * first {@link MAX_DIGITS}); and EMPTY for anything else.
 */
function normalize(buf: DigitBuffer): DigitBuffer {
  // The typeof check guards untyped callers (plain JS, deserialized data): `test` would coerce a
  // number such as 90 to '90' and `replace` would then throw, and `test` throws on a symbol.
  if (typeof buf !== 'string' || !ASCII_DIGITS.test(buf)) return EMPTY
  return buf.replace(LEADING_ZEROS, '').slice(0, MAX_DIGITS)
}

/** Splits a buffer, left-padded with zeros to six digits, into its `HH`, `MM` and `SS` pairs. */
function pairs(buf: DigitBuffer): readonly [string, string, string] {
  const padded = normalize(buf).padStart(MAX_DIGITS, '0')
  return [padded.slice(0, 2), padded.slice(2, 4), padded.slice(4, 6)]
}

/**
 * Tells whether `x` is a valid digit buffer: a string of at most six ASCII digits that does not
 * start with `'0'`. The empty string is valid. Non-strings, locale digits (`'١'`), separators,
 * signs and whitespace are not.
 */
export function isDigitBuffer(x: unknown): x is DigitBuffer {
  return (
    typeof x === 'string' && x.length <= MAX_DIGITS && ASCII_DIGITS.test(x) && !x.startsWith('0')
  )
}

/**
 * Appends one typed digit on the right. A valid buffer is returned unchanged when `digit` is not
 * exactly one ASCII digit (`'a'`, `'10'`, `''`, `'١'`, key names like `'Numpad5'`), when `digit` is
 * `'0'` and nothing is typed yet (leading zeros are ignored), or when the buffer already holds
 * {@link MAX_DIGITS} digits (a seventh digit is ignored). Any other string is first read as the
 * valid buffer it stands for (see the module notes), so the result is always a valid buffer.
 */
export function pushDigit(buf: DigitBuffer, digit: string): DigitBuffer {
  const current = normalize(buf)
  if (typeof digit !== 'string' || !SINGLE_DIGIT.test(digit)) return current
  if (current.length >= MAX_DIGITS) return current
  if (current === EMPTY && digit === '0') return current
  return current + digit
}

/**
 * Removes the last typed digit (Backspace). An empty buffer is returned unchanged. The result is
 * always a valid buffer, and for a valid `buf`, `popDigit(pushDigit(buf, d))` is `buf` whenever the
 * push changed it.
 */
export function popDigit(buf: DigitBuffer): DigitBuffer {
  return normalize(buf).slice(0, -1)
}

/**
 * Tells whether nothing is typed. This is true exactly when {@link toDurationMs} is 0, including
 * for a string that is not a valid buffer.
 */
export function isEmpty(buf: DigitBuffer): boolean {
  return normalize(buf) === EMPTY
}

/**
 * Splits the buffer into fields as typed, left-padded to six digits: `'13030'` → 1 h 30 min 30 s,
 * `'90'` → 0 h 0 min 90 s. An empty buffer gives all zeros.
 */
export function toFields(buf: DigitBuffer): DigitFields {
  const [hours, minutes, seconds] = pairs(buf)
  return { hours: Number(hours), minutes: Number(minutes), seconds: Number(seconds) }
}

/**
 * Converts the buffer to a duration, normalizing overflow: `'90'` → 90 000 ms (1:30), `'7500'` →
 * 4 500 000 ms (1:15:00), `''` → 0. The longest buffer, `'999999'`, is 362 439 000 ms.
 */
export function toDurationMs(buf: DigitBuffer): Ms {
  const { hours, minutes, seconds } = toFields(buf)
  return (hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds) * MS_PER_SECOND
}

/**
 * Formats the buffer as `HH:MM:SS` exactly as typed, without normalizing overflow, in ASCII digits:
 * `''` → `00:00:00`, `'1'` → `00:00:01`, `'90'` → `00:00:90`, `'13030'` → `01:30:30`,
 * `'999999'` → `99:99:99`.
 */
export function formatTyped(buf: DigitBuffer): string {
  return pairs(buf).join(':')
}
