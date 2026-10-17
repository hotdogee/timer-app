/**
 * Display formatting for the core engine: durations for timer and stopwatch faces, and the
 * wall-clock end-time label. Durations always use ASCII digits, `:` between fields and `.` before
 * centiseconds (locale digit shaping is a later i18n concern). See spec.md › Time format.
 */
import type { EpochMs, Ms, TimeStyle } from './types'

/** A duration split into display fields. Produced by {@link splitMs}. */
export interface DurationParts {
  /** Whole hours. Unbounded: five days is 120 hours. */
  readonly hours: number
  /** Minutes past the hour, 0–59. */
  readonly minutes: number
  /** Seconds past the minute, 0–59. */
  readonly seconds: number
  /** Hundredths of a second past the second, 0–99. */
  readonly centis: number
}

/** Options for {@link formatClockTime}. An omitted or `undefined` field uses the runtime default. */
export interface ClockTimeOptions {
  /** BCP 47 language tag, e.g. `'en-US'`. An invalid tag falls back to the runtime default locale. */
  readonly locale?: string | undefined
  /** `'h12'` (`2:47 PM`) or `'h23'` (`14:47`). Omit to follow the locale's convention. */
  readonly hourCycle?: 'h12' | 'h23' | undefined
  /** IANA time zone, e.g. `'UTC'`. An unknown zone falls back to the runtime default zone. */
  readonly timeZone?: string | undefined
}

/**
 * Largest duration formatted exactly. Larger finite inputs are capped here so the arithmetic stays
 * exact and hours never print in exponent notation (`1e+21`). About 285,000 years.
 */
const MAX_DURATION_MS = Number.MAX_SAFE_INTEGER

/** A JavaScript Date holds instants up to ±100,000,000 days from the epoch. */
const MAX_DATE_MS = 8.64e15

type Hms = Omit<DurationParts, 'centis'>

/** Clamps a duration to [0, MAX_DURATION_MS]; negative, NaN and ±Infinity become 0. */
function clampDuration(ms: number): Ms {
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.min(ms, MAX_DURATION_MS)
}

/** Splits a non-negative whole number of seconds into hours, minutes and seconds. */
function splitSeconds(totalSeconds: number): Hms {
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** Compact `M:SS` under an hour and `H:MM:SS` from an hour; fixed `HH:MM:SS`. */
function formatHms({ hours, minutes, seconds }: Hms, style: TimeStyle): string {
  if (style === 'fixed') return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  if (hours > 0) return `${hours}:${pad2(minutes)}:${pad2(seconds)}`
  return `${minutes}:${pad2(seconds)}`
}

/**
 * Splits a duration into hours, minutes, seconds and centiseconds, each rounded down.
 * Negative, NaN and ±Infinity give all zeros; finite values above `Number.MAX_SAFE_INTEGER` are
 * capped to it.
 */
export function splitMs(ms: Ms): DurationParts {
  const totalCentis = Math.floor(clampDuration(ms) / 10)
  return { ...splitSeconds(Math.floor(totalCentis / 100)), centis: totalCentis % 100 }
}

/**
 * Formats a timer's remaining time, rounded up to the whole second so it reads `0:01` until the
 * exact end and `0:00` when ringing starts. Compact: `M:SS` under an hour (`4:53`), `H:MM:SS`
 * from an hour (`1:30:30`), with the shape picked after rounding (3,599,001 ms is `1:00:00`).
 * Fixed: `HH:MM:SS` (`00:04:53`); hours grow past 99. Negative, NaN and ±Infinity show zero, and
 * any style other than `'fixed'` renders compact.
 */
export function formatCountdown(ms: Ms, style: TimeStyle = 'compact'): string {
  return formatHms(splitSeconds(Math.ceil(clampDuration(ms) / 1000)), style)
}

/**
 * Formats time past a timer's end as `-` plus the countdown shape, rounded down to the whole
 * second: `-0:12`, fixed `-00:00:12`. Zero whole seconds has no minus, so the first second of
 * ringing reads `0:00` like the finished countdown (spec.md › Time format) instead of `-0:00`.
 * Negative, NaN and ±Infinity also show `0:00`, and any style other than `'fixed'` renders
 * compact.
 */
export function formatOvertime(ms: Ms, style: TimeStyle = 'compact'): string {
  const seconds = Math.floor(clampDuration(ms) / 1000)
  const body = formatHms(splitSeconds(seconds), style)
  return seconds === 0 ? body : `-${body}`
}

/**
 * Formats stopwatch elapsed time, rounded down to the centisecond. Compact: `S.cc` under a minute
 * (`0.00`, `59.99`), `M:SS.cc` under an hour (`1:05.43`), `H:MM:SS.cc` from an hour.
 * Fixed: `HH:MM:SS.cc`. Negative, NaN and ±Infinity show zero, and any style other than `'fixed'`
 * renders compact.
 */
export function formatElapsed(ms: Ms, style: TimeStyle = 'compact'): string {
  const parts = splitMs(ms)
  const centis = pad2(parts.centis)
  if (style !== 'fixed' && parts.hours === 0 && parts.minutes === 0) {
    return `${parts.seconds}.${centis}`
  }
  return `${formatHms(parts, style)}.${centis}`
}

/** Returns the locale tag if `Intl` accepts it, else `undefined` (the runtime default). */
function validLocale(locale: string | undefined): string | undefined {
  if (locale === undefined) return undefined
  try {
    return Intl.getCanonicalLocales(locale)[0]
  } catch {
    return undefined
  }
}

function clockTimeFormat({ locale, hourCycle, timeZone }: ClockTimeOptions): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }
  // Checked at runtime because options may come from untyped settings.
  if (hourCycle === 'h12' || hourCycle === 'h23') options.hourCycle = hourCycle
  const tag = validLocale(locale)
  if (timeZone !== undefined) {
    try {
      return new Intl.DateTimeFormat(tag, { ...options, timeZone })
    } catch {
      // Unknown zone (e.g. synced from a device with newer tz data): use the runtime default.
    }
  }
  return new Intl.DateTimeFormat(tag, options)
}

/**
 * Formats an instant as a wall-clock time of hours and minutes, e.g. the end-time label
 * (`2:47 PM`, or `14:47` with `hourCycle: 'h23'`). Seconds are dropped, not rounded. Omitted
 * options use the runtime default locale, hour cycle and time zone, read on every call; an invalid
 * locale or time zone falls back to the default instead of throwing, and `null` options (from
 * untyped settings) count as omitted. Returns `''` for NaN, ±Infinity and instants outside the
 * Date range (±8.64e15 ms).
 */
export function formatClockTime(at: EpochMs, options?: ClockTimeOptions): string {
  if (!Number.isFinite(at) || Math.abs(at) > MAX_DATE_MS) return ''
  // `??` rather than a default parameter: a default covers only `undefined`, not a stored `null`.
  return clockTimeFormat(options ?? {}).format(at)
}
