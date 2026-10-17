/**
 * Settings: the types, defaults and validation of every user setting (spec.md › Settings), split
 * into two groups. Device settings (appearance and language) stay on one device; synced settings
 * (behavior and the keymap) follow the account. Pure: no DOM, no storage. The settings store in
 * `src/state` validates everything it reads and writes through {@link migrateDeviceSettings} and
 * {@link migrateSyncedSettings}.
 *
 * Validation never throws and always yields a complete settings object: unknown fields are
 * dropped, a field of the wrong type or an unknown choice falls back to its default, and a number
 * out of range is clamped into it (and rounded where the setting has whole steps). Results are
 * frozen.
 */
import * as v from 'valibot'

import { ACTION_IDS, DEFAULT_BINDINGS, parseCombo, type ActionId, type Bindings } from './keymap'
import type { Ms, TimeStyle } from './types'

export type { TimeStyle } from './types'

export type ThemeMode = 'system' | 'light' | 'dark'
export type FontId = 'roboto-flex' | 'inter' | 'system'
export type Density = 'comfortable' | 'compact'
/** The clock-time format: the locale's convention (`'auto'`), 12-hour or 24-hour. */
export type HourCycle = 'auto' | 'h12' | 'h23'
/** A built-in alarm sound; the same ids as `platform/audio`'s `SoundId`. */
export type SoundId = 'chime' | 'bell' | 'beep'
/** A UI language the app ships. */
export type Locale = 'en' | 'zh-TW' | 'ja'

/** Every choice of each setting with a fixed set of values, in display order. Frozen. */
export const THEME_MODES: readonly ThemeMode[] = Object.freeze(['system', 'light', 'dark'])
export const FONT_IDS: readonly FontId[] = Object.freeze(['roboto-flex', 'inter', 'system'])
export const DENSITIES: readonly Density[] = Object.freeze(['comfortable', 'compact'])
export const HOUR_CYCLES: readonly HourCycle[] = Object.freeze(['auto', 'h12', 'h23'])
export const TIME_STYLES: readonly TimeStyle[] = Object.freeze(['compact', 'fixed'])
export const SOUND_IDS: readonly SoundId[] = Object.freeze(['chime', 'bell', 'beep'])
/** The languages the app ships, the base language (`'en'`) first. */
export const LOCALES: readonly Locale[] = Object.freeze(['en', 'zh-TW', 'ja'])

/** The user's changes to the default shortcuts: replacement combos per action. */
export type KeymapOverrides = Readonly<Partial<Record<ActionId, readonly string[]>>>

/** Appearance and language: per device, never synced (spec › Sync). */
export interface DeviceSettings {
  readonly themeMode: ThemeMode
  /** The theme's seed color as lowercase `#rrggbb`, or `''` for the default seed. */
  readonly seed: string
  /** The font of the whole UI, digits included. */
  readonly font: FontId
  /** The weight of the digits: 300–700 in steps of 100. */
  readonly fontWeight: number
  /** The digits' size as a multiple of the designed size: 0.75–1.5. */
  readonly digitScale: number
  /** The ring's stroke width as a multiple of the designed width: 0.5–2. */
  readonly ringScale: number
  readonly density: Density
  /** The UI language, or `'auto'` to follow the browser's languages. */
  readonly locale: Locale | 'auto'
}

/** Behavior and the keymap: synced across the user's devices. */
export interface SyncedSettings {
  readonly timeStyle: TimeStyle
  readonly hourCycle: HourCycle
  /** The three quick-add chips' durations, each 1 s – 24 h in whole seconds. */
  readonly quickAdd: readonly [Ms, Ms, Ms]
  readonly sound: SoundId
  /** Alarm volume: 0–1. */
  readonly volume: number
  /** Whether the alarm sound loops until dismissed (otherwise it plays once). */
  readonly loop: boolean
  /** Minutes after which a ringing alarm goes quiet: 0 (never) to 60, whole minutes. */
  readonly autoStopMinutes: number
  /** Whether a ringing timer counts up in overtime (`-0:12`) or stays at `0:00`. */
  readonly showOvertime: boolean
  readonly notifications: boolean
  /** Whether deleting a card asks first. */
  readonly confirmDelete: boolean
  /** The user's changes to the default shortcuts (see {@link bindingsWith}); `{}` when none. */
  readonly keymap: KeymapOverrides
}

/** The current version of both settings groups' shape; stored next to them. */
export const SETTINGS_SCHEMA_VERSION = 1

/** A numeric setting's bounds and the step a control should use. */
export interface SettingRange {
  readonly min: number
  readonly max: number
  readonly step: number
}

/**
 * The bounds of every numeric setting. Values outside are clamped. `fontWeight`,
 * `autoStopMinutes` and each `quickAdd` duration are also rounded to their step; for the others
 * the step is only the slider's.
 */
export const SETTING_RANGES = Object.freeze({
  fontWeight: Object.freeze({ min: 300, max: 700, step: 100 }),
  digitScale: Object.freeze({ min: 0.75, max: 1.5, step: 0.05 }),
  ringScale: Object.freeze({ min: 0.5, max: 2, step: 0.1 }),
  volume: Object.freeze({ min: 0, max: 1, step: 0.05 }),
  autoStopMinutes: Object.freeze({ min: 0, max: 60, step: 1 }),
  quickAdd: Object.freeze({ min: 1000, max: 86_400_000, step: 1000 }),
}) satisfies Readonly<Record<string, SettingRange>>

/** The device settings of a new install. Frozen. */
export const DEVICE_DEFAULTS: DeviceSettings = Object.freeze({
  themeMode: 'system',
  seed: '',
  font: 'roboto-flex',
  fontWeight: 400,
  digitScale: 1,
  ringScale: 1,
  density: 'comfortable',
  locale: 'auto',
})

/** The synced settings of a new install. Frozen, `quickAdd` and `keymap` too. */
export const SYNCED_DEFAULTS: SyncedSettings = Object.freeze({
  timeStyle: 'compact',
  hourCycle: 'auto',
  quickAdd: Object.freeze([30_000, 60_000, 300_000] as const),
  sound: 'chime',
  volume: 0.8,
  loop: true,
  autoStopMinutes: 0,
  showOvertime: true,
  notifications: true,
  confirmDelete: false,
  keymap: Object.freeze({}),
})

/** Whether `value` is one of {@link LOCALES}. */
export function isLocale(value: unknown): value is Locale {
  return (LOCALES as readonly unknown[]).includes(value)
}

/** The most combos kept per action, and the longest combo text kept, from untrusted overrides. */
const MAX_COMBOS_PER_ACTION = 8
const MAX_COMBO_LENGTH = 64

const NO_OVERRIDES: KeymapOverrides = SYNCED_DEFAULTS.keymap

/**
 * Keymap overrides made safe: only own keys that are actions, each a list of combo texts that
 * parse (`keymap.parseCombo`); other entries are dropped. An empty list (the action unbound) is
 * kept, but a list whose every entry is invalid is dropped, so that action keeps its default.
 */
function cleanKeymap(input: unknown): KeymapOverrides {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return NO_OVERRIDES
  const record = input as Readonly<Record<string, unknown>>
  const out: Partial<Record<ActionId, readonly string[]>> = {}
  let count = 0
  for (const action of ACTION_IDS) {
    if (!Object.hasOwn(record, action)) continue
    const texts = record[action]
    if (!Array.isArray(texts)) continue
    const valid = (texts as readonly unknown[]).filter(
      (text): text is string =>
        typeof text === 'string' &&
        text.length <= MAX_COMBO_LENGTH &&
        parseCombo(text, 'other') !== null,
    )
    if (valid.length === 0 && texts.length > 0) continue
    out[action] = Object.freeze(valid.slice(0, MAX_COMBOS_PER_ACTION))
    count++
  }
  return count === 0 ? NO_OVERRIDES : Object.freeze(out)
}

/** Bindings already built, per overrides object, so the same overrides give the same bindings. */
const bindingsCache = new WeakMap<object, Bindings>()

/**
 * The effective shortcuts: `keymap.DEFAULT_BINDINGS` with each overridden action's combos
 * replaced by its override (an empty list unbinds the action). Invalid overrides are ignored, as
 * in validation. With no valid override this is `DEFAULT_BINDINGS` itself, and the same overrides
 * object always gives the same frozen bindings, so the keymap's per-bindings cache keeps working.
 */
export function bindingsWith(overrides: KeymapOverrides): Bindings {
  if (typeof overrides !== 'object' || overrides === null) return DEFAULT_BINDINGS
  const cached = bindingsCache.get(overrides)
  if (cached !== undefined) return cached
  const clean = cleanKeymap(overrides)
  const bindings =
    clean === NO_OVERRIDES ? DEFAULT_BINDINGS : Object.freeze({ ...DEFAULT_BINDINGS, ...clean })
  bindingsCache.set(overrides, bindings)
  return bindings
}

/** A number setting: finite numbers are clamped into `range`, then rounded to `round` if given. */
function ranged(range: SettingRange, fallback: number, round?: number) {
  return v.fallback(
    v.pipe(
      v.number(),
      v.finite(),
      v.transform((n) => {
        const clamped = Math.min(range.max, Math.max(range.min, n))
        // The bounds are multiples of the step, so rounding stays inside them.
        return round === undefined ? clamped : Math.round(clamped / round) * round
      }),
    ),
    fallback,
  )
}

/** `#rgb` or `#rrggbb`, the `#` optional, as `parseSeed` in ui/theme accepts. */
const SEED_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** A seed color as lowercase `#rrggbb`, `''` for blank input, or `null` when it is not a color. */
function seedColor(input: string): string | null {
  const text = input.trim()
  if (text === '') return ''
  const digits = SEED_PATTERN.exec(text)?.[1]?.toLowerCase()
  if (digits === undefined) return null
  return `#${digits.length === 3 ? digits.replace(/./g, '$&$&') : digits}`
}

const deviceSchema = v.object({
  themeMode: v.fallback(v.picklist(THEME_MODES), DEVICE_DEFAULTS.themeMode),
  seed: v.fallback(v.pipe(v.string(), v.transform(seedColor), v.string()), DEVICE_DEFAULTS.seed),
  font: v.fallback(v.picklist(FONT_IDS), DEVICE_DEFAULTS.font),
  fontWeight: ranged(
    SETTING_RANGES.fontWeight,
    DEVICE_DEFAULTS.fontWeight,
    SETTING_RANGES.fontWeight.step,
  ),
  digitScale: ranged(SETTING_RANGES.digitScale, DEVICE_DEFAULTS.digitScale),
  ringScale: ranged(SETTING_RANGES.ringScale, DEVICE_DEFAULTS.ringScale),
  density: v.fallback(v.picklist(DENSITIES), DEVICE_DEFAULTS.density),
  locale: v.fallback(v.picklist([...LOCALES, 'auto' as const]), DEVICE_DEFAULTS.locale),
})

/** One quick-add chip's duration; falls back to that chip's default. */
function quickAddChip(index: 0 | 1 | 2) {
  const range = SETTING_RANGES.quickAdd
  return ranged(range, SYNCED_DEFAULTS.quickAdd[index], range.step)
}

const syncedSchema = v.object({
  timeStyle: v.fallback(v.picklist(TIME_STYLES), SYNCED_DEFAULTS.timeStyle),
  hourCycle: v.fallback(v.picklist(HOUR_CYCLES), SYNCED_DEFAULTS.hourCycle),
  quickAdd: v.fallback(
    v.tuple([quickAddChip(0), quickAddChip(1), quickAddChip(2)]),
    SYNCED_DEFAULTS.quickAdd,
  ),
  sound: v.fallback(v.picklist(SOUND_IDS), SYNCED_DEFAULTS.sound),
  volume: ranged(SETTING_RANGES.volume, SYNCED_DEFAULTS.volume),
  loop: v.fallback(v.boolean(), SYNCED_DEFAULTS.loop),
  autoStopMinutes: ranged(
    SETTING_RANGES.autoStopMinutes,
    SYNCED_DEFAULTS.autoStopMinutes,
    SETTING_RANGES.autoStopMinutes.step,
  ),
  showOvertime: v.fallback(v.boolean(), SYNCED_DEFAULTS.showOvertime),
  notifications: v.fallback(v.boolean(), SYNCED_DEFAULTS.notifications),
  confirmDelete: v.fallback(v.boolean(), SYNCED_DEFAULTS.confirmDelete),
  keymap: v.fallback(v.pipe(v.unknown(), v.transform(cleanKeymap)), NO_OVERRIDES),
})

/** One upgrade step: settings data of version `n` in, data of version `n + 1` out. */
export type SettingsMigration = (data: unknown) => unknown

/**
 * Upgrade steps per group: `steps[n - 1]` turns version `n` into `n + 1`, so the latest version is
 * `steps.length + 1`, which must equal {@link SETTINGS_SCHEMA_VERSION}. None yet.
 */
const DEVICE_MIGRATIONS: readonly SettingsMigration[] = []
const SYNCED_MIGRATIONS: readonly SettingsMigration[] = []

/**
 * Brings settings data of `version` up to the latest version (`steps.length + 1`) by running every
 * step from `steps[version - 1]` on, in order. Data without a usable version (`undefined`, or not
 * a positive whole number) or from a newer app (a version past the latest) is returned as it is,
 * for the current schema to read leniently.
 */
export function runMigrations(
  data: unknown,
  version: number | undefined,
  steps: readonly SettingsMigration[],
): unknown {
  if (version === undefined || !Number.isInteger(version) || version < 1) return data
  let out = data
  for (const step of steps.slice(version - 1)) out = step(out)
  return out
}

/** The fields of `data` as the schemas read them: a value that is not an object has none. */
function fields(data: unknown): object {
  return typeof data === 'object' && data !== null ? data : {}
}

/**
 * Validates device settings from anywhere (storage, an import file, a partial update spread over
 * the current settings), first upgrading data of an older `version` (see {@link runMigrations};
 * omitted means current). Never throws; see the module notes for the rules.
 */
export function migrateDeviceSettings(input: unknown, version?: number): DeviceSettings {
  // Every field has a fallback, so parsing an object cannot fail.
  const data = fields(runMigrations(input, version, DEVICE_MIGRATIONS))
  return Object.freeze(v.parse(deviceSchema, data))
}

/** {@link migrateDeviceSettings} for the synced settings. */
export function migrateSyncedSettings(input: unknown, version?: number): SyncedSettings {
  const output = v.parse(syncedSchema, fields(runMigrations(input, version, SYNCED_MIGRATIONS)))
  return Object.freeze({ ...output, quickAdd: Object.freeze(output.quickAdd) })
}
