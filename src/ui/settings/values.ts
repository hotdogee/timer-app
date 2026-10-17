/**
 * Display helpers for the settings rows: how slider values read, the auto-stop choices and the
 * time format example. Pure; labels are messages and `Intl` in the given locale.
 */
import { formatCountdown, settings, type Ms } from '../../core'
import { m } from '../../i18n'

/** The app version from package.json, inlined by Vite (`define` in vite.config.ts). */
export const APP_VERSION: string = __APP_VERSION__

/** `value` as a whole percentage in `locale` (`1.25` is `125%`). */
export function percentText(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
}

/** The auto-stop choices the menu offers, in minutes; 0 is never. */
export const AUTO_STOP_CHOICES: readonly number[] = Object.freeze([0, 1, 2, 3, 5, 10, 15, 30, 60])

/**
 * The auto-stop choices to list: {@link AUTO_STOP_CHOICES}, plus `current` in order when it is
 * another valid value (one set elsewhere, such as an import), so the menu always shows it.
 */
export function autoStopChoices(current: number): readonly number[] {
  if (AUTO_STOP_CHOICES.includes(current) || !Number.isInteger(current)) return AUTO_STOP_CHOICES
  const range = settings.SETTING_RANGES.autoStopMinutes
  if (current < range.min || current > range.max) return AUTO_STOP_CHOICES
  return [...AUTO_STOP_CHOICES, current].sort((a, b) => a - b)
}

/** An auto-stop choice's label: "Never" for 0, otherwise "5 minutes". */
export function autoStopLabel(minutes: number): string {
  return minutes === 0
    ? m.settings_auto_stop_never()
    : m.settings_auto_stop_minutes({ count: minutes })
}

/** The duration the time format description shows in both styles (4:53 and 00:04:53). */
export const TIME_STYLE_EXAMPLE: Ms = 293_000

/** The time format row's description, with the example in both styles. */
export function timeStyleDescription(): string {
  return m.settings_time_style_description({
    compact: formatCountdown(TIME_STYLE_EXAMPLE, 'compact'),
    fixed: formatCountdown(TIME_STYLE_EXAMPLE, 'fixed'),
  })
}
