import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  EMPTY,
  MAX_DIGITS,
  formatTyped,
  isDigitBuffer,
  isEmpty,
  popDigit,
  pushDigit,
  toDurationMs,
  toFields,
} from './digit-entry'
import type { DigitBuffer } from './types'

/** 99:99:99 normalized: 99 h + 99 min + 99 s. */
const MAX_DURATION_MS = (99 * 3600 + 99 * 60 + 99) * 1000

/** Simulates typing each key in order, starting from an empty buffer. */
function type(...keys: string[]): DigitBuffer {
  return keys.reduce<DigitBuffer>((buf, key) => pushDigit(buf, key), EMPTY)
}

/** Passes a value that the type system would reject, as an untyped caller might. */
function untyped(value: unknown): string {
  return value as string
}

const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

/** Strings that are not one ASCII digit, though some look like one or contain one. */
const NON_DIGIT_KEYS = [
  'a',
  '10',
  '',
  ' ',
  '5 ',
  '-',
  '.',
  ':',
  '١', // Arabic-Indic digit one
  '۵', // Extended Arabic-Indic digit five
  '５', // fullwidth digit five
  '²', // superscript two
  'Numpad5', // KeyboardEvent.code, not .key
  'Digit5',
  'Backspace',
  'Enter',
]

const asciiDigit = fc.constantFrom(...DIGIT_KEYS)

/**
 * Any valid buffer: a non-zero digit followed by up to five more digits, or now and then empty.
 * The empty buffer is weighted down so that most runs exercise real digits.
 */
const digitBuffer: fc.Arbitrary<DigitBuffer> = fc.oneof(
  { arbitrary: fc.constant(EMPTY), weight: 1 },
  {
    arbitrary: fc
      .tuple(
        fc.constantFrom('1', '2', '3', '4', '5', '6', '7', '8', '9'),
        fc.string({ unit: asciiDigit, maxLength: MAX_DIGITS - 1 }),
      )
      .map(([first, rest]) => first + rest),
    weight: 9,
  },
)

/** A key as the keyboard layer might pass it: mostly digits, sometimes anything at all. */
const key = fc.oneof(
  { arbitrary: asciiDigit, weight: 4 },
  { arbitrary: fc.string({ unit: 'grapheme', maxLength: 3 }), weight: 1 },
  { arbitrary: fc.string({ unit: 'binary', maxLength: 2 }), weight: 1 },
)

/** A valid buffer behind one to three zeros, such as `'000090'`, `'0'` or `'000123456'`. */
const zeroPadded = fc
  .tuple(fc.string({ unit: fc.constant('0'), minLength: 1, maxLength: 3 }), digitBuffer)
  .map(([zeros, buf]) => zeros + buf)

/** A run of ASCII digits longer than a buffer holds, such as `'1234567'`. */
const overLong = fc.string({
  unit: asciiDigit,
  minLength: MAX_DIGITS + 1,
  maxLength: MAX_DIGITS + 4,
})

/** Any run of ASCII digits that need not be a valid buffer: zero-padded, too long, or random. */
const digitRun = fc.oneof(
  zeroPadded,
  overLong,
  fc.string({ unit: asciiDigit, maxLength: MAX_DIGITS + 4 }),
)

/**
 * Any string, as might arrive from untyped code or corrupted data. About a fifth each: valid,
 * zero-padded, too long, random digits, and junk.
 */
const anyString = fc.oneof(
  { arbitrary: digitBuffer, weight: 1 },
  { arbitrary: digitRun, weight: 3 },
  { arbitrary: fc.string({ unit: 'binary', maxLength: 8 }), weight: 1 },
)

describe('constants', () => {
  it('allows six digits, two each for hours, minutes and seconds', () => {
    expect(MAX_DIGITS).toBe(6)
  })

  it('represents nothing typed as the empty string, which is a valid buffer', () => {
    expect(EMPTY).toBe('')
    expect(isDigitBuffer(EMPTY)).toBe(true)
  })
})

describe('isDigitBuffer', () => {
  it.each(['', '1', '9', '10', '90', '7500', '13030', '100000', '999999'])('accepts %j', (buf) => {
    expect(isDigitBuffer(buf)).toBe(true)
  })

  it.each(['0', '05', '00', '000090'])('rejects %j, which starts with a zero', (buf) => {
    expect(isDigitBuffer(buf)).toBe(false)
  })

  it.each(['1234567', '9999999', '1000000'])(
    'rejects %j, which has more than six digits',
    (buf) => {
      expect(isDigitBuffer(buf)).toBe(false)
    },
  )

  it.each(['١', '١٢', '５', '1５'])('rejects %j, which contains non-ASCII digits', (buf) => {
    expect(isDigitBuffer(buf)).toBe(false)
  })

  it.each(['a', '12a', '1:30', ' 1', '1 ', '1\n', '+1', '-1', '1.5', '1e3', 'NaN'])(
    'rejects %j, which contains a character that is not a digit',
    (buf) => {
      expect(isDigitBuffer(buf)).toBe(false)
    },
  )

  it.each<[string, unknown]>([
    ['a number', 5],
    ['zero', 0],
    ['null', null],
    ['undefined', undefined],
    ['an object', { buf: '5' }],
    ['an array', ['5']],
    ['a boolean', true],
    ['a symbol', Symbol('5')],
  ])('rejects %s', (_label, value) => {
    expect(isDigitBuffer(value)).toBe(false)
  })
})

describe('pushDigit', () => {
  it('appends a digit on the right', () => {
    expect(pushDigit('1', '3')).toBe('13')
  })

  it('builds 13030 one key at a time', () => {
    expect(type('1', '3', '0', '3', '0')).toBe('13030')
  })

  it.each(DIGIT_KEYS)('accepts the digit %j, which is also what a numpad key reports', (digit) => {
    expect(pushDigit('1', digit)).toBe(`1${digit}`)
  })

  it.each(NON_DIGIT_KEYS)('ignores %j and returns the buffer unchanged', (input) => {
    expect(pushDigit('12', input)).toBe('12')
    expect(pushDigit(EMPTY, input)).toBe(EMPTY)
  })

  it.each<[string, unknown]>([
    ['a number', 5],
    ['null', null],
    ['undefined', undefined],
    ['a symbol', Symbol('5')],
  ])('ignores %s from an untyped caller without throwing', (_label, value) => {
    expect(pushDigit('12', untyped(value))).toBe('12')
  })

  describe('leading zeros', () => {
    it('ignores 0 on an empty buffer', () => {
      expect(pushDigit(EMPTY, '0')).toBe(EMPTY)
    })

    it("gives '5' for 0 then 5", () => {
      expect(type('0', '5')).toBe('5')
    })

    it("gives '50' for 5 then 0", () => {
      expect(type('5', '0')).toBe('50')
    })

    it('ignores any number of leading zeros', () => {
      expect(type('0', '0', '0', '0', '0', '0', '0', '1', '2')).toBe('12')
    })

    it('keeps zeros after the first significant digit', () => {
      expect(type('1', '0', '0', '0', '0', '0')).toBe('100000')
    })
  })

  describe('maximum length', () => {
    it('accepts a sixth digit', () => {
      expect(pushDigit('12345', '6')).toBe('123456')
    })

    it('ignores a seventh digit', () => {
      expect(pushDigit('123456', '7')).toBe('123456')
    })

    it('ignores a seventh zero', () => {
      expect(pushDigit('100000', '0')).toBe('100000')
    })

    it('keeps the first six significant digits of a longer typing run', () => {
      expect(type('0', '9', '8', '7', '6', '5', '4', '3', '2', '1')).toBe('987654')
    })
  })

  describe('strings that are not valid buffers', () => {
    it('continues after the zeros of a zero-padded string, however long', () => {
      expect(pushDigit('000090', '1')).toBe('901')
      expect(pushDigit('0000090', '1')).toBe('901')
    })

    it('reads a run of more than six digits as its first six and ignores the new digit', () => {
      expect(pushDigit('1234567', '5')).toBe('123456')
      expect(pushDigit('0001234567', '8')).toBe('123456')
    })

    it('returns the reading of an invalid string even when the key is ignored', () => {
      expect(pushDigit('000090', 'x')).toBe('90')
      expect(pushDigit('1234567', 'x')).toBe('123456')
      expect(pushDigit('abc', 'x')).toBe(EMPTY)
    })

    it.each(['abc', '-5', '١', '1:30', '12a'])('starts over from EMPTY for %j', (buf) => {
      expect(pushDigit(buf, '5')).toBe('5')
      expect(pushDigit(buf, '0')).toBe(EMPTY)
    })

    it('returns EMPTY for a non-string buffer from an untyped caller', () => {
      expect(pushDigit(untyped(null), '5')).toBe('5')
      expect(pushDigit(untyped(undefined), 'a')).toBe(EMPTY)
    })
  })
})

describe('popDigit', () => {
  it('removes the last digit', () => {
    expect(popDigit('13030')).toBe('1303')
  })

  it('empties a one-digit buffer', () => {
    expect(popDigit('5')).toBe(EMPTY)
  })

  it('returns an empty buffer unchanged', () => {
    expect(popDigit(EMPTY)).toBe(EMPTY)
  })

  it('keeps inner zeros that become trailing', () => {
    expect(popDigit('1005')).toBe('100')
  })

  it('removes digits back to empty, one per call', () => {
    const steps = ['123456']
    for (let i = 0; i < MAX_DIGITS; i += 1) steps.push(popDigit(steps.at(-1) ?? EMPTY))
    expect(steps).toEqual(['123456', '12345', '1234', '123', '12', '1', ''])
  })

  it('removes the last digit of a zero-padded string and drops its zeros', () => {
    expect(popDigit('000090')).toBe('9')
    expect(popDigit('0000090')).toBe('9')
  })

  it('reads a run of more than six digits as its first six, then removes the last', () => {
    expect(popDigit('1234567')).toBe('12345')
  })

  it.each(['abc', '-5', '١', '0000000'])('returns EMPTY for %j', (buf) => {
    expect(popDigit(buf)).toBe(EMPTY)
  })

  it('returns EMPTY for a non-string buffer from an untyped caller', () => {
    expect(popDigit(untyped(undefined))).toBe(EMPTY)
  })
})

describe('isEmpty', () => {
  it('is true for the empty buffer', () => {
    expect(isEmpty(EMPTY)).toBe(true)
  })

  it.each(['1', '50', '100000', '999999'])('is false for %j', (buf) => {
    expect(isEmpty(buf)).toBe(false)
  })

  it.each(['000090', '0000090', '1234567'])(
    'is false for %j, which reads as digits typed',
    (buf) => {
      expect(isEmpty(buf)).toBe(false)
    },
  )

  it.each(['0', '000000', '0000000', 'abc', '١'])(
    'is true for %j, which reads as nothing typed',
    (buf) => {
      expect(isEmpty(buf)).toBe(true)
    },
  )
})

describe('toFields', () => {
  it.each([
    ['13030', { hours: 1, minutes: 30, seconds: 30 }],
    ['90', { hours: 0, minutes: 0, seconds: 90 }],
    ['', { hours: 0, minutes: 0, seconds: 0 }],
    ['1', { hours: 0, minutes: 0, seconds: 1 }],
    ['7500', { hours: 0, minutes: 75, seconds: 0 }],
    ['100000', { hours: 10, minutes: 0, seconds: 0 }],
    ['999999', { hours: 99, minutes: 99, seconds: 99 }],
  ])('splits %j as typed into %o', (buf, fields) => {
    expect(toFields(buf)).toEqual(fields)
  })

  it('reads a zero-padded string the same as the typed buffer, however long', () => {
    expect(toFields('000090')).toEqual({ hours: 0, minutes: 0, seconds: 90 })
    expect(toFields('0000090')).toEqual({ hours: 0, minutes: 0, seconds: 90 })
  })

  it('reads a run of more than six digits as its first six', () => {
    expect(toFields('1234567')).toEqual({ hours: 12, minutes: 34, seconds: 56 })
  })

  it.each(['abc', '-5', '١٢', '1:30'])('reads %j as all zeros', (buf) => {
    expect(toFields(buf)).toEqual({ hours: 0, minutes: 0, seconds: 0 })
  })
})

describe('toDurationMs', () => {
  it('normalizes 90 seconds to 1:30', () => {
    expect(toDurationMs('90')).toBe(90_000)
  })

  it('normalizes 75 minutes to 1:15:00', () => {
    expect(toDurationMs('7500')).toBe(4_500_000)
  })

  it('is 0 for the empty buffer', () => {
    expect(toDurationMs(EMPTY)).toBe(0)
  })

  it.each([
    ['1', 1_000],
    ['59', 59_000],
    ['100', 60_000],
    ['13030', 5_430_000],
    ['10000', 3_600_000],
    ['100000', 36_000_000],
  ])('converts %j to %d ms', (buf, ms) => {
    expect(toDurationMs(buf)).toBe(ms)
  })

  it('is 362,439,000 ms for the longest buffer, 99:99:99', () => {
    expect(toDurationMs('999999')).toBe(362_439_000)
    expect(toDurationMs('999999')).toBe(MAX_DURATION_MS)
  })

  it.each([
    ['000090', 90_000],
    ['0000090', 90_000],
    ['1234567', 45_296_000],
  ])('reads the digit run %j as typed, %d ms', (buf, ms) => {
    expect(toDurationMs(buf)).toBe(ms)
  })

  it.each(['abc', '-90', '1.5', 'NaN', 'Infinity', '١', '0000000'])('is 0 for %j', (buf) => {
    expect(toDurationMs(buf)).toBe(0)
  })
})

describe('formatTyped', () => {
  it.each([
    ['', '00:00:00'],
    ['1', '00:00:01'],
    ['90', '00:00:90'],
    ['13030', '01:30:30'],
    ['999999', '99:99:99'],
    ['7500', '00:75:00'],
    ['100000', '10:00:00'],
  ])('shows %j as %j', (buf, shown) => {
    expect(formatTyped(buf)).toBe(shown)
  })

  it('shows a zero-padded string the same as the typed buffer, however long', () => {
    expect(formatTyped('000090')).toBe('00:00:90')
    expect(formatTyped('0000090')).toBe('00:00:90')
  })

  it('shows a run of more than six digits as its first six', () => {
    expect(formatTyped('1234567')).toBe('12:34:56')
  })

  it.each(['abc', '١', '-1', '1:30'])('shows %j as 00:00:00', (buf) => {
    expect(formatTyped(buf)).toBe('00:00:00')
  })
})

describe('properties', () => {
  it('pushDigit always returns a valid buffer, whatever it is given', () => {
    fc.assert(
      fc.property(anyString, key, (buf, input) => {
        expect(isDigitBuffer(pushDigit(buf, input))).toBe(true)
      }),
    )
  })

  it('popDigit always returns a valid buffer, whatever it is given', () => {
    fc.assert(
      fc.property(anyString, (buf) => {
        expect(isDigitBuffer(popDigit(buf))).toBe(true)
      }),
    )
  })

  it('popDigit undoes every pushDigit that changed a valid buffer', () => {
    fc.assert(
      fc.property(digitBuffer, key, (buf, input) => {
        const pushed = pushDigit(buf, input)
        fc.pre(pushed !== buf)
        expect(popDigit(pushed)).toBe(buf)
      }),
    )
  })

  it('pushDigit either appends the key as given or returns a valid buffer unchanged', () => {
    fc.assert(
      fc.property(digitBuffer, key, (buf, input) => {
        expect([buf, buf + input]).toContain(pushDigit(buf, input))
      }),
    )
  })

  it('typing keeps the first six significant ASCII digits and ignores everything else', () => {
    fc.assert(
      fc.property(fc.array(key, { maxLength: 16 }), (keys) => {
        const typedDigits = keys.filter((k) => k.length === 1 && k >= '0' && k <= '9').join('')
        const significant = typedDigits.replace(/^0+/, '').slice(0, 6)
        expect(type(...keys)).toBe(significant)
      }),
    )
  })

  it('toDurationMs reads formatTyped output with the colons stripped as the same duration', () => {
    fc.assert(
      fc.property(digitBuffer, (buf) => {
        expect(toDurationMs(formatTyped(buf).replaceAll(':', ''))).toBe(toDurationMs(buf))
      }),
    )
  })

  it('formatTyped shows the buffer right-aligned in six zero-padded digits', () => {
    fc.assert(
      fc.property(digitBuffer, (buf) => {
        const shown = formatTyped(buf)
        expect(shown).toMatch(/^[0-9]{2}:[0-9]{2}:[0-9]{2}$/)
        expect(shown.replaceAll(':', '').replace(/^0+/, '')).toBe(buf)
      }),
    )
  })

  it('toDurationMs matches the place values of the typed number', () => {
    fc.assert(
      fc.property(digitBuffer, (buf) => {
        const n = buf === '' ? 0 : Number.parseInt(buf, 10)
        const hours = Math.floor(n / 10_000)
        const minutes = Math.floor(n / 100) % 100
        const seconds = n % 100
        expect(toDurationMs(buf)).toBe(((hours * 60 + minutes) * 60 + seconds) * 1000)
      }),
    )
  })

  it('toDurationMs is a whole number of seconds from 0 to the 99:99:99 maximum', () => {
    fc.assert(
      fc.property(anyString, (buf) => {
        const ms = toDurationMs(buf)
        expect(Number.isInteger(ms / 1000)).toBe(true)
        expect(ms).toBeGreaterThanOrEqual(0)
        expect(ms).toBeLessThanOrEqual(MAX_DURATION_MS)
      }),
    )
  })

  it('toFields gives whole numbers from 0 to 99 for any string', () => {
    fc.assert(
      fc.property(anyString, (buf) => {
        for (const field of Object.values(toFields(buf))) {
          expect(Number.isInteger(field)).toBe(true)
          expect(field).toBeGreaterThanOrEqual(0)
          expect(field).toBeLessThanOrEqual(99)
        }
      }),
    )
  })

  it('isEmpty is true exactly when the duration is 0', () => {
    fc.assert(
      fc.property(anyString, (buf) => {
        expect(isEmpty(buf)).toBe(toDurationMs(buf) === 0)
      }),
    )
  })

  it('reads any run of ASCII digits as typing those digits key by key', () => {
    fc.assert(
      fc.property(digitRun, (digits) => {
        const typed = type(...Array.from(digits))
        expect(pushDigit(digits, 'x')).toBe(typed)
        expect(popDigit(digits)).toBe(popDigit(typed))
        expect(isEmpty(digits)).toBe(isEmpty(typed))
        expect(toFields(digits)).toEqual(toFields(typed))
        expect(toDurationMs(digits)).toBe(toDurationMs(typed))
        expect(formatTyped(digits)).toBe(formatTyped(typed))
      }),
    )
  })

  it('reads any string with a character that is not an ASCII digit as nothing typed', () => {
    const digits = fc.string({ unit: asciiDigit, maxLength: 4 })
    const notADigit = fc
      .string({ unit: 'binary', minLength: 1, maxLength: 1 })
      .filter((c) => !DIGIT_KEYS.some((d) => d === c))
    fc.assert(
      fc.property(digits, notADigit, digits, (before, junk, after) => {
        const buf = before + junk + after
        expect(pushDigit(buf, '5')).toBe('5')
        expect(popDigit(buf)).toBe(EMPTY)
        expect(isEmpty(buf)).toBe(true)
        expect(formatTyped(buf)).toBe('00:00:00')
      }),
    )
  })

  it('every accepted digit makes the duration longer', () => {
    fc.assert(
      fc.property(digitBuffer, asciiDigit, (buf, digit) => {
        const pushed = pushDigit(buf, digit)
        fc.pre(pushed !== buf)
        expect(toDurationMs(pushed)).toBeGreaterThan(toDurationMs(buf))
      }),
    )
  })
})
