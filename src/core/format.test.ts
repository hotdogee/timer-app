import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

import {
  formatClockTime,
  formatCountdown,
  formatElapsed,
  formatOvertime,
  splitMs,
  type ClockTimeOptions,
} from './format'
import type { TimeStyle } from './types'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Inputs that are not valid durations; every formatter treats them as 0. */
const INVALID_DURATIONS = [-1, -HOUR, -0, Number.NaN, Infinity, -Infinity]

/** Durations from 0 to two days, where all the shape changes happen, plus the full safe range. */
const durationMs = fc.oneof(fc.integer({ min: 0, max: 2 * DAY }), fc.maxSafeNat())

const STYLES: readonly TimeStyle[] = ['compact', 'fixed']

/**
 * Test oracle: reads a formatted duration (`[-][H:]M:SS[.cc]`, `S.cc` or `HH:MM:SS[.cc]`) back
 * into whole centiseconds, independently of the formatter.
 */
function toCentis(text: string): number {
  const [clock = '', centis = '0'] = text.replace(/^-/, '').split('.')
  const seconds = clock.split(':').reduce((total, field) => total * 60 + Number(field), 0)
  return seconds * 100 + Number(centis)
}

/**
 * Stands in for a value read from untyped storage (settings JSON), which the type system cannot
 * vouch for at runtime.
 */
function untrusted<T>(value: unknown): T {
  return value as T
}

/** Compact countdown/overtime body: `M:SS` (M 0–59) or `H:MM:SS` (H ≥ 1, no leading zero). */
const COMPACT_HMS = String.raw`(?:[1-9]\d*:[0-5]\d:[0-5]\d|[1-5]?\d:[0-5]\d)`
/** Fixed body: two-digit hours, or more digits without a leading zero. */
const FIXED_HMS = String.raw`(?:\d{2}|[1-9]\d{2,}):[0-5]\d:[0-5]\d`
const SHAPES = {
  countdown: {
    compact: new RegExp(`^${COMPACT_HMS}$`),
    fixed: new RegExp(`^${FIXED_HMS}$`),
  },
  // Unsigned zero, or a minus before any non-zero body (never `-0:00`).
  overtime: {
    compact: new RegExp(`^(?:0:00|-(?!0:00$)${COMPACT_HMS})$`),
    fixed: new RegExp(`^(?:00:00:00|-(?!00:00:00$)${FIXED_HMS})$`),
  },
  elapsed: {
    // `S.cc` under a minute, `M:SS.cc` (M 1–59) under an hour, then `H:MM:SS.cc`.
    compact: /^(?:[1-9]\d*:[0-5]\d:[0-5]\d|(?:[1-9]|[1-5]\d):[0-5]\d|[1-5]?\d)\.\d{2}$/,
    fixed: new RegExp(`^${FIXED_HMS}\\.\\d{2}$`),
  },
} as const

describe('splitMs', () => {
  it.each([
    { ms: 0, parts: { hours: 0, minutes: 0, seconds: 0, centis: 0 } },
    { ms: 999, parts: { hours: 0, minutes: 0, seconds: 0, centis: 99 } },
    { ms: 1000, parts: { hours: 0, minutes: 0, seconds: 1, centis: 0 } },
    { ms: 59_999, parts: { hours: 0, minutes: 0, seconds: 59, centis: 99 } },
    { ms: 60_000, parts: { hours: 0, minutes: 1, seconds: 0, centis: 0 } },
    { ms: 3_599_999, parts: { hours: 0, minutes: 59, seconds: 59, centis: 99 } },
    { ms: 3_600_000, parts: { hours: 1, minutes: 0, seconds: 0, centis: 0 } },
    { ms: 3_723_450, parts: { hours: 1, minutes: 2, seconds: 3, centis: 45 } },
    { ms: 5 * DAY, parts: { hours: 120, minutes: 0, seconds: 0, centis: 0 } },
  ])('splits $ms ms into $parts', ({ ms, parts }) => {
    expect(splitMs(ms)).toEqual(parts)
  })

  it('rounds partial centiseconds down', () => {
    expect(splitMs(9).centis).toBe(0)
    expect(splitMs(19.99).centis).toBe(1)
    expect(splitMs(1234.56)).toEqual({ hours: 0, minutes: 0, seconds: 1, centis: 23 })
  })

  it.each(INVALID_DURATIONS)('returns all zeros for %s', (ms) => {
    expect(splitMs(ms)).toEqual({ hours: 0, minutes: 0, seconds: 0, centis: 0 })
  })

  it('caps finite values above Number.MAX_SAFE_INTEGER instead of losing precision', () => {
    const capped = { hours: 2_501_999_792, minutes: 59, seconds: 0, centis: 99 }
    expect(splitMs(Number.MAX_SAFE_INTEGER)).toEqual(capped)
    expect(splitMs(1e300)).toEqual(capped)
    expect(splitMs(Number.MAX_VALUE)).toEqual(capped)
  })

  it('property: fields stay in range and recombine to the input rounded down to 10 ms', () => {
    const anyDuration = fc.oneof(durationMs, fc.double({ min: 0, max: 1e13, noNaN: true }))
    fc.assert(
      fc.property(anyDuration, (ms) => {
        const { hours, minutes, seconds, centis } = splitMs(ms)
        expect(Number.isInteger(hours) && hours >= 0).toBe(true)
        expect(minutes).toBeGreaterThanOrEqual(0)
        expect(minutes).toBeLessThanOrEqual(59)
        expect(seconds).toBeGreaterThanOrEqual(0)
        expect(seconds).toBeLessThanOrEqual(59)
        expect(centis).toBeGreaterThanOrEqual(0)
        expect(centis).toBeLessThanOrEqual(99)
        const totalMs = (((hours * 60 + minutes) * 60 + seconds) * 100 + centis) * 10
        expect(totalMs).toBeLessThanOrEqual(ms)
        expect(ms).toBeLessThan(totalMs + 10)
      }),
    )
  })
})

describe('formatCountdown', () => {
  it.each([
    { ms: 0, compact: '0:00', fixed: '00:00:00' },
    { ms: 1, compact: '0:01', fixed: '00:00:01' },
    { ms: 999, compact: '0:01', fixed: '00:00:01' },
    { ms: 1000, compact: '0:01', fixed: '00:00:01' },
    { ms: 1001, compact: '0:02', fixed: '00:00:02' },
    { ms: 5000, compact: '0:05', fixed: '00:00:05' },
    { ms: 59_999, compact: '1:00', fixed: '00:01:00' },
    { ms: 60_000, compact: '1:00', fixed: '00:01:00' },
    { ms: 293_000, compact: '4:53', fixed: '00:04:53' },
    { ms: 3_599_000, compact: '59:59', fixed: '00:59:59' },
    { ms: 3_599_001, compact: '1:00:00', fixed: '01:00:00' },
    { ms: 3_599_999, compact: '1:00:00', fixed: '01:00:00' },
    { ms: 3_600_000, compact: '1:00:00', fixed: '01:00:00' },
    { ms: 5_430_000, compact: '1:30:30', fixed: '01:30:30' },
    { ms: 100 * HOUR, compact: '100:00:00', fixed: '100:00:00' },
    { ms: 5 * DAY, compact: '120:00:00', fixed: '120:00:00' },
  ])('shows $ms ms as $compact (compact) and $fixed (fixed)', ({ ms, compact, fixed }) => {
    expect(formatCountdown(ms, 'compact')).toBe(compact)
    expect(formatCountdown(ms, 'fixed')).toBe(fixed)
  })

  it('defaults to the compact style', () => {
    expect(formatCountdown(293_000)).toBe('4:53')
  })

  it('reads 0:01 until the exact end and 0:00 only at the end', () => {
    expect(formatCountdown(1000)).toBe('0:01')
    expect(formatCountdown(0.001)).toBe('0:01')
    expect(formatCountdown(0)).toBe('0:00')
  })

  it('rounds partial seconds up', () => {
    expect(formatCountdown(4000)).toBe('0:04')
    expect(formatCountdown(4001)).toBe('0:05')
    expect(formatCountdown(4999)).toBe('0:05')
  })

  it('picks the hour shape from the rounded-up value', () => {
    expect(formatCountdown(59_001)).toBe('1:00')
    expect(formatCountdown(3_599_001)).toBe('1:00:00')
  })

  it.each(INVALID_DURATIONS)('shows zero for %s', (ms) => {
    expect(formatCountdown(ms, 'compact')).toBe('0:00')
    expect(formatCountdown(ms, 'fixed')).toBe('00:00:00')
  })

  it('caps huge finite values so hours print as plain digits', () => {
    expect(formatCountdown(1e300, 'compact')).toBe('2501999792:59:01')
  })

  it('renders compact for a style value outside TimeStyle (e.g. from stored settings)', () => {
    expect(formatCountdown(293_000, untrusted<TimeStyle>('bogus'))).toBe('4:53')
  })

  it('property: shows the remaining time rounded up to the whole second in both styles', () => {
    fc.assert(
      fc.property(durationMs, (ms) => {
        for (const style of STYLES) {
          const text = formatCountdown(ms, style)
          expect(text).toMatch(SHAPES.countdown[style])
          const seconds = toCentis(text) / 100
          expect(seconds * SECOND).toBeGreaterThanOrEqual(ms)
          expect((seconds - 1) * SECOND).toBeLessThan(ms)
        }
      }),
    )
  })
})

describe('formatOvertime', () => {
  it.each([
    { ms: 0, compact: '0:00', fixed: '00:00:00' },
    { ms: 999, compact: '0:00', fixed: '00:00:00' },
    { ms: 1000, compact: '-0:01', fixed: '-00:00:01' },
    { ms: 12_000, compact: '-0:12', fixed: '-00:00:12' },
    { ms: 12_999, compact: '-0:12', fixed: '-00:00:12' },
    { ms: 59_999, compact: '-0:59', fixed: '-00:00:59' },
    { ms: 60_000, compact: '-1:00', fixed: '-00:01:00' },
    { ms: 3_599_999, compact: '-59:59', fixed: '-00:59:59' },
    { ms: 3_600_000, compact: '-1:00:00', fixed: '-01:00:00' },
    { ms: 5 * DAY, compact: '-120:00:00', fixed: '-120:00:00' },
  ])('shows $ms ms as $compact (compact) and $fixed (fixed)', ({ ms, compact, fixed }) => {
    expect(formatOvertime(ms, 'compact')).toBe(compact)
    expect(formatOvertime(ms, 'fixed')).toBe(fixed)
  })

  it('defaults to the compact style', () => {
    expect(formatOvertime(12_000)).toBe('-0:12')
  })

  it('reads 0:00 without a minus until a whole second of overtime has passed', () => {
    expect(formatOvertime(0)).toBe('0:00')
    expect(formatOvertime(999.999)).toBe('0:00')
    expect(formatOvertime(1000)).toBe('-0:01')
  })

  it('rounds partial seconds down, unlike the countdown', () => {
    expect(formatOvertime(12_500)).toBe('-0:12')
    expect(formatCountdown(12_500)).toBe('0:13')
  })

  it('switches to the hour shape at exactly one hour', () => {
    expect(formatOvertime(HOUR - 1)).toBe('-59:59')
    expect(formatOvertime(HOUR)).toBe('-1:00:00')
  })

  it.each(INVALID_DURATIONS)('shows 0:00 for %s', (ms) => {
    expect(formatOvertime(ms, 'compact')).toBe('0:00')
    expect(formatOvertime(ms, 'fixed')).toBe('00:00:00')
  })

  it('renders compact for a style value outside TimeStyle (e.g. from stored settings)', () => {
    expect(formatOvertime(12_000, untrusted<TimeStyle>('bogus'))).toBe('-0:12')
  })

  it('property: shows the overtime rounded down to the whole second, with a minus once non-zero', () => {
    fc.assert(
      fc.property(durationMs, (ms) => {
        for (const style of STYLES) {
          const text = formatOvertime(ms, style)
          expect(text).toMatch(SHAPES.overtime[style])
          expect(text.startsWith('-')).toBe(ms >= SECOND)
          const seconds = toCentis(text) / 100
          expect(seconds * SECOND).toBeLessThanOrEqual(ms)
          expect((seconds + 1) * SECOND).toBeGreaterThan(ms)
        }
      }),
    )
  })
})

describe('formatElapsed', () => {
  it.each([
    { ms: 0, compact: '0.00', fixed: '00:00:00.00' },
    { ms: 9, compact: '0.00', fixed: '00:00:00.00' },
    { ms: 10, compact: '0.01', fixed: '00:00:00.01' },
    { ms: 999, compact: '0.99', fixed: '00:00:00.99' },
    { ms: 1000, compact: '1.00', fixed: '00:00:01.00' },
    { ms: 9990, compact: '9.99', fixed: '00:00:09.99' },
    { ms: 59_999, compact: '59.99', fixed: '00:00:59.99' },
    { ms: 60_000, compact: '1:00.00', fixed: '00:01:00.00' },
    { ms: 65_430, compact: '1:05.43', fixed: '00:01:05.43' },
    { ms: 3_599_999, compact: '59:59.99', fixed: '00:59:59.99' },
    { ms: 3_600_000, compact: '1:00:00.00', fixed: '01:00:00.00' },
    { ms: 3_605_430, compact: '1:00:05.43', fixed: '01:00:05.43' },
    { ms: 5 * DAY, compact: '120:00:00.00', fixed: '120:00:00.00' },
  ])('shows $ms ms as $compact (compact) and $fixed (fixed)', ({ ms, compact, fixed }) => {
    expect(formatElapsed(ms, 'compact')).toBe(compact)
    expect(formatElapsed(ms, 'fixed')).toBe(fixed)
  })

  it('defaults to the compact style', () => {
    expect(formatElapsed(65_430)).toBe('1:05.43')
  })

  it('rounds partial centiseconds down, so a minute never shows early', () => {
    expect(formatElapsed(59_999.9)).toBe('59.99')
    expect(formatElapsed(1019)).toBe('1.01')
  })

  it.each(INVALID_DURATIONS)('shows 0.00 for %s', (ms) => {
    expect(formatElapsed(ms, 'compact')).toBe('0.00')
    expect(formatElapsed(ms, 'fixed')).toBe('00:00:00.00')
  })

  it('renders compact for a style value outside TimeStyle (e.g. from stored settings)', () => {
    expect(formatElapsed(65_430, untrusted<TimeStyle>('bogus'))).toBe('1:05.43')
  })

  it('property: shows the elapsed time rounded down to the centisecond in both styles', () => {
    fc.assert(
      fc.property(durationMs, (ms) => {
        for (const style of STYLES) {
          const text = formatElapsed(ms, style)
          expect(text).toMatch(SHAPES.elapsed[style])
          const centis = toCentis(text)
          expect(centis * 10).toBeLessThanOrEqual(ms)
          expect((centis + 1) * 10).toBeGreaterThan(ms)
        }
      }),
    )
  })
})

describe('duration formatters on arbitrary numbers', () => {
  it('property: never throw and always render ASCII digits in the documented shape', () => {
    fc.assert(
      fc.property(fc.double(), (ms) => {
        for (const style of STYLES) {
          expect(formatCountdown(ms, style)).toMatch(SHAPES.countdown[style])
          expect(formatOvertime(ms, style)).toMatch(SHAPES.overtime[style])
          expect(formatElapsed(ms, style)).toMatch(SHAPES.elapsed[style])
        }
      }),
    )
  })
})

describe('formatClockTime', () => {
  /** 2026-10-17 14:47 UTC: daylight saving time in New York, none in Taipei. */
  const at = Date.UTC(2026, 9, 17, 14, 47)
  const utcUs = { locale: 'en-US', timeZone: 'UTC' } as const

  it('shows 12-hour time with h12 and 24-hour time with h23', () => {
    expect(formatClockTime(at, { ...utcUs, hourCycle: 'h12' })).toBe('2:47 PM')
    expect(formatClockTime(at, { ...utcUs, hourCycle: 'h23' })).toBe('14:47')
  })

  it.each([
    { locale: 'en-US', expected: '2:47 PM' },
    { locale: 'en-GB', expected: '14:47' },
    { locale: 'ja', expected: '14:47' },
    { locale: 'zh-TW', expected: '下午2:47' },
  ])('follows the $locale 12/24-hour convention when hourCycle is omitted', (row) => {
    expect(formatClockTime(at, { locale: row.locale, timeZone: 'UTC' })).toBe(row.expected)
  })

  it('lets hourCycle override the locale convention', () => {
    expect(formatClockTime(at, { locale: 'en-GB', timeZone: 'UTC', hourCycle: 'h12' })).toBe(
      '2:47 pm',
    )
    expect(formatClockTime(at, { locale: 'zh-TW', timeZone: 'UTC', hourCycle: 'h23' })).toBe(
      '14:47',
    )
  })

  it('shows midnight and noon per hour cycle', () => {
    const midnight = Date.UTC(2026, 9, 17, 0, 5)
    const noon = Date.UTC(2026, 9, 17, 12, 0)
    expect(formatClockTime(midnight, { ...utcUs, hourCycle: 'h12' })).toBe('12:05 AM')
    expect(formatClockTime(midnight, { ...utcUs, hourCycle: 'h23' })).toBe('00:05')
    expect(formatClockTime(noon, { ...utcUs, hourCycle: 'h12' })).toBe('12:00 PM')
    expect(formatClockTime(noon, { ...utcUs, hourCycle: 'h23' })).toBe('12:00')
  })

  it('pads minutes to two digits but not the hour', () => {
    expect(formatClockTime(Date.UTC(2026, 9, 17, 9, 5), utcUs)).toBe('9:05 AM')
  })

  it('drops seconds without rounding up to the next minute', () => {
    expect(formatClockTime(Date.UTC(2026, 9, 17, 14, 47, 59, 999), utcUs)).toBe('2:47 PM')
  })

  it.each([
    { timeZone: 'Asia/Taipei', expected: '22:47' },
    { timeZone: 'Asia/Kolkata', expected: '20:17' },
    { timeZone: 'America/New_York', expected: '10:47' },
  ])('converts to the $timeZone time zone', ({ timeZone, expected }) => {
    expect(formatClockTime(at, { locale: 'en-US', hourCycle: 'h23', timeZone })).toBe(expected)
  })

  it('formats far-future and pre-epoch instants without clamping them', () => {
    expect(formatClockTime(Date.UTC(2030, 0, 1), utcUs)).toBe('12:00 AM')
    expect(formatClockTime(Date.UTC(1969, 11, 31, 23, 59), utcUs)).toBe('11:59 PM')
    expect(formatClockTime(8.64e15, utcUs)).toBe('12:00 AM')
  })

  it.each([Number.NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1])(
    'returns an empty string for %s, which is not a valid instant',
    (instant) => {
      expect(formatClockTime(instant, utcUs)).toBe('')
    },
  )

  it.each(['not a locale', '', 'en_US'])('falls back to the default locale for %j', (locale) => {
    expect(formatClockTime(at, { locale, timeZone: 'UTC' })).toBe(
      formatClockTime(at, { timeZone: 'UTC' }),
    )
  })

  it.each(['Mars/Olympus_Mons', '', 'UTC+25'])(
    'falls back to the default time zone for %j',
    (timeZone) => {
      expect(formatClockTime(at, { locale: 'en-US', timeZone })).toBe(
        formatClockTime(at, { locale: 'en-US' }),
      )
    },
  )

  it('ignores an hourCycle value outside the allowed set (e.g. from stored settings)', () => {
    const options = { ...utcUs, hourCycle: untrusted<ClockTimeOptions['hourCycle']>('h99') }
    expect(formatClockTime(at, options)).toBe('2:47 PM')
  })

  it('treats explicitly undefined options like omitted ones', () => {
    expect(formatClockTime(at, { locale: 'en-US', timeZone: 'UTC', hourCycle: undefined })).toBe(
      formatClockTime(at, utcUs),
    )
  })

  it('treats null options (e.g. from stored settings) like omitted ones', () => {
    expect(formatClockTime(at, untrusted<ClockTimeOptions>(null))).toBe(formatClockTime(at))
  })

  it('uses the runtime default locale when locale is omitted', () => {
    const runtimeLocale = new Intl.DateTimeFormat().resolvedOptions().locale
    expect(formatClockTime(at, { timeZone: 'UTC' })).toBe(
      formatClockTime(at, { timeZone: 'UTC', locale: runtimeLocale }),
    )
  })

  it('uses the runtime default time zone, read on every call, when timeZone is omitted', () => {
    // Node applies TZ changes immediately; deleting TZ does not, so restore the zone explicitly.
    const originalZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
    const options = { locale: 'en-US', hourCycle: 'h23' } as const
    try {
      vi.stubEnv('TZ', 'Asia/Tokyo')
      // Changing TZ reaches ICU only on a process's main thread (Vitest's default 'forks' pool).
      // In a worker thread ('threads' pool) the zone stays put, so fail here with that reason.
      expect(
        new Intl.DateTimeFormat().resolvedOptions().timeZone,
        'TZ stub did not change the runtime zone: this test needs the forks pool, not threads',
      ).toBe('Asia/Tokyo')
      expect(formatClockTime(at, options)).toBe('23:47')
      vi.stubEnv('TZ', 'America/New_York')
      expect(formatClockTime(at, options)).toBe('10:47')
    } finally {
      vi.stubEnv('TZ', originalZone)
      vi.unstubAllEnvs()
    }
  })

  it('property: never throws; valid instants match an independent UTC h12 label, others give ""', () => {
    // Mostly real instants across the whole Date range, plus arbitrary doubles for the odd values.
    const anyInstant = fc.oneof(fc.integer({ min: -8.64e15, max: 8.64e15 }), fc.double())
    fc.assert(
      fc.property(anyInstant, (instant) => {
        const text = formatClockTime(instant, utcUs)
        if (Number.isFinite(instant) && Math.abs(instant) <= 8.64e15) {
          // Date and Intl both truncate fractional milliseconds toward zero (TimeClip).
          const date = new Date(instant)
          const hour = date.getUTCHours()
          const minute = String(date.getUTCMinutes()).padStart(2, '0')
          expect(text).toBe(`${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`)
        } else {
          expect(text).toBe('')
        }
      }),
    )
  })
})
