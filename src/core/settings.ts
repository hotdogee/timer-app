/**
 * Settings: the types, defaults and validation of every user setting (spec.md › Settings), split
 * into groups. Device settings (appearance and language) stay on one device; synced settings
 * (behavior and the keymap) follow the account. The desktop app adds two more device-only groups:
 * the desktop settings (launch at login, close behavior, the mini window, global hotkeys) and the
 * desktop sign-in's bearer token. Pure: no DOM, no storage. The settings store in `src/state`
 * validates everything it reads and writes through {@link migrateDeviceSettings},
 * {@link migrateSyncedSettings}, {@link migrateDesktopSettings} and {@link migrateDeviceAuth}.
 *
 * The desktop and auth groups are kept apart from {@link DeviceSettings} on purpose: the export
 * file (Settings › Data) carries the device settings, and neither this machine's hotkeys nor its
 * token may travel in a file or be overwritten by importing one.
 *
 * Validation never throws and always yields a complete settings object: unknown fields are
 * dropped, a field of the wrong type or an unknown choice falls back to its default, and a number
 * out of range is clamped into it (and rounded where the setting has whole steps). Results are
 * frozen.
 */
import * as v from 'valibot'

import { ACTION_IDS, DEFAULT_BINDINGS, parseCombo, type ActionId, type Bindings } from './keymap'
import type { EpochMs, Ms, TimeStyle } from './types'

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

/**
 * What closing the desktop app's main window does (spec Q11): hide it to the tray while a timer
 * runs or rings and quit otherwise, always hide it to the tray, or always quit.
 */
export type CloseBehavior = 'tray-while-running' | 'tray' | 'quit'
/** Every {@link CloseBehavior}, in display order. Frozen. */
export const CLOSE_BEHAVIORS: readonly CloseBehavior[] = Object.freeze([
  'tray-while-running',
  'tray',
  'quit',
])

/**
 * A global hotkey of the desktop app: start or pause the last-used card, and show or hide the
 * app. Global hotkeys work while another app has the focus.
 */
export type HotkeyId = 'toggleLast' | 'showApp'
/** Every {@link HotkeyId}, in display order. Frozen. */
export const HOTKEY_IDS: readonly HotkeyId[] = Object.freeze(['toggleLast', 'showApp'])

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

/**
 * The global hotkeys' combos in the keymap's portable binding text (`'Mod+Shift+Space'`), or null
 * when unbound. Both are unbound by default: global hotkeys are opt-in (spec › Keyboard).
 */
export type DesktopHotkeys = Readonly<Record<HotkeyId, string | null>>

/** The desktop app's settings (Settings › Desktop): per machine, never synced or exported. */
export interface DesktopSettings {
  /** Whether the app starts, hidden to the tray, when the user logs in to the OS. */
  readonly launchAtLogin: boolean
  readonly closeBehavior: CloseBehavior
  /** Whether the mini window floats above other apps. */
  readonly miniAlwaysOnTop: boolean
  readonly hotkeys: DesktopHotkeys
}

/**
 * A change to some desktop settings: any top-level field, and any of the hotkeys (the others keep
 * their combos). See {@link updateDesktopSettings}.
 */
export type DesktopSettingsUpdate = Partial<Omit<DesktopSettings, 'hotkeys'>> & {
  readonly hotkeys?: Partial<DesktopHotkeys>
}

/**
 * The desktop sign-in's bearer token (spec › Sync › Desktop sign-in): the desktop app has no
 * session cookie, so it keeps the token the device-authorization flow returned, on this machine
 * only, until it signs out or the token expires.
 */
export interface DeviceAuth {
  /** The session token, sent as `Authorization: Bearer <token>` and in the sync subprotocol. */
  readonly token: string
  /** When the session expires: epoch milliseconds. */
  readonly expiresAt: EpochMs
}

/**
 * The current version of the settings groups' shape; stored next to them. The desktop and auth
 * groups came later as new values of their own, so data without them simply reads as their
 * defaults and needed no new version.
 */
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

/** The desktop settings of a new install: no autostart, Q11's close behavior, no hotkeys. */
export const DESKTOP_DEFAULTS: DesktopSettings = Object.freeze({
  launchAtLogin: false,
  closeBehavior: 'tray-while-running',
  miniAlwaysOnTop: true,
  hotkeys: Object.freeze({ toggleLast: null, showApp: null }),
})

/** The longest bearer token kept; Better Auth's session tokens are far shorter. */
export const MAX_AUTH_TOKEN_LENGTH = 4096

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

/**
 * A global hotkey's combo: binding text that parses (`keymap.parseCombo`), at most
 * {@link MAX_COMBO_LENGTH} characters, kept as written; anything else, blank text included, is
 * null (unbound).
 */
function hotkeyCombo(input: unknown): string | null {
  return typeof input === 'string' &&
    input.trim() !== '' &&
    input.length <= MAX_COMBO_LENGTH &&
    parseCombo(input, 'other') !== null
    ? input
    : null
}

const hotkey = v.fallback(v.pipe(v.unknown(), v.transform(hotkeyCombo)), null)

const desktopSchema = v.object({
  launchAtLogin: v.fallback(v.boolean(), DESKTOP_DEFAULTS.launchAtLogin),
  closeBehavior: v.fallback(v.picklist(CLOSE_BEHAVIORS), DESKTOP_DEFAULTS.closeBehavior),
  miniAlwaysOnTop: v.fallback(v.boolean(), DESKTOP_DEFAULTS.miniAlwaysOnTop),
  hotkeys: v.fallback(v.object({ toggleLast: hotkey, showApp: hotkey }), DESKTOP_DEFAULTS.hotkeys),
})

/** Visible ASCII only: a token travels in HTTP headers and is percent-encoded for a subprotocol. */
const TOKEN_PATTERN = /^[\x21-\x7e]+$/

const authSchema = v.object({
  token: v.pipe(v.string(), v.maxLength(MAX_AUTH_TOKEN_LENGTH), v.regex(TOKEN_PATTERN)),
  expiresAt: v.pipe(v.number(), v.finite(), v.gtValue(0)),
})

/** One upgrade step: settings data of version `n` in, data of version `n + 1` out. */
export type SettingsMigration = (data: unknown) => unknown

/**
 * Upgrade steps per group: `steps[n - 1]` turns version `n` into `n + 1`, so the latest version is
 * `steps.length + 1`, which must equal {@link SETTINGS_SCHEMA_VERSION}. None yet.
 */
const DEVICE_MIGRATIONS: readonly SettingsMigration[] = []
const SYNCED_MIGRATIONS: readonly SettingsMigration[] = []
const DESKTOP_MIGRATIONS: readonly SettingsMigration[] = []

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

/**
 * Validates desktop settings from anywhere (storage, an update spread over the current settings),
 * as {@link migrateDeviceSettings} does: unknown fields are dropped, and each field of the wrong
 * type or an unknown choice falls back to its default. A hotkey whose combo does not parse (or is
 * blank, or longer than 64 characters) reads as unbound. Never throws; the result is frozen, its
 * `hotkeys` too. Data from before the desktop group existed has none of its fields, so it reads
 * as {@link DESKTOP_DEFAULTS}.
 */
export function migrateDesktopSettings(input: unknown, version?: number): DesktopSettings {
  const output = v.parse(desktopSchema, fields(runMigrations(input, version, DESKTOP_MIGRATIONS)))
  return Object.freeze({ ...output, hotkeys: Object.freeze(output.hotkeys) })
}

/**
 * `current` with `update` applied: top-level fields replace their values, and `update.hotkeys`
 * replaces only the hotkeys it names. Validated like {@link migrateDesktopSettings}.
 */
export function updateDesktopSettings(
  current: DesktopSettings,
  update: DesktopSettingsUpdate,
): DesktopSettings {
  return migrateDesktopSettings({
    ...current,
    ...update,
    hotkeys: { ...current.hotkeys, ...update.hotkeys },
  })
}

/**
 * Validates a stored bearer token: a non-empty string of visible ASCII characters, at most
 * {@link MAX_AUTH_TOKEN_LENGTH} long, with a positive finite `expiresAt`. Returns null when either
 * field is missing or invalid (there is no default token). Expiry is not checked here (this module
 * reads no clock): compare `expiresAt` with the current time before using the token. Never throws;
 * the result is frozen and carries only those two fields.
 */
export function migrateDeviceAuth(input: unknown): DeviceAuth | null {
  const result = v.safeParse(authSchema, fields(input))
  if (!result.success) return null
  return Object.freeze({ token: result.output.token, expiresAt: result.output.expiresAt })
}
