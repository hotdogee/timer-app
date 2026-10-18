/**
 * The layout of the two TinyBase stores (tech-stack.md › Data store) and the pure codecs between
 * them and the app's own values: cards, presets and both settings groups.
 *
 * - `synced` (a `MergeableStore`, synced across tabs now and devices in M4) holds the `cards` and
 *   `presets` tables and, as values, the behavior settings plus `schemaVersion` and `seededAt`. A
 *   card's row has its kind, name, creation time, mute flag, icon (only when it has one), grid
 *   position and phase, and the cells of that phase.
 * - `device` (a plain `Store`, never synced) holds the appearance settings and the language as
 *   values, plus `schemaVersion`; on the desktop also the desktop settings and the desktop
 *   sign-in's bearer token.
 *
 * Every field is its own cell, not one JSON blob per card, so under sync a rename on one device and
 * a start on another merge cell by cell instead of one clobbering the other. No cell has a schema
 * default: a default written by a fresh install would carry a newer timestamp than the user's real
 * value and win the merge. Absent cells mean "default", and the codecs fill them in.
 *
 * The decoders never throw and accept anything a merge can leave behind (a row missing cells, stale
 * cells of another phase, a row without a kind after a delete raced an edit): what cannot be read
 * falls back field by field, and a row that is not a card at all decodes to `null`.
 */
import type { TablesSchema, ValuesSchema } from 'tinybase/with-schemas'

import {
  cards,
  settings,
  timer,
  type EpochMs,
  type Ms,
  type StopwatchState,
  type TimerState,
} from '../core'
import { isPresetDuration, presetName, type Preset } from '../state/presets'

/** The version of this layout (both stores), stored as the `schemaVersion` value. */
export const SCHEMA_VERSION = settings.SETTINGS_SCHEMA_VERSION

/** The tables of the synced store. Row ids are card and preset ids. */
export const SYNCED_TABLES_SCHEMA = {
  cards: {
    kind: { type: 'string' },
    name: { type: 'string' },
    createdAt: { type: 'number' },
    muted: { type: 'boolean' },
    /** The card's emoji (`cards.isCardIcon`); absent for the kind's default icon. */
    icon: { type: 'string' },
    /** The card's index in the grid. */
    position: { type: 'number' },
    /** Timer: `idle|running|paused|ringing`; stopwatch: `idle|running|paused`. */
    phase: { type: 'string' },
    /** Timer phases' fields; a cell is absent when the phase has no such field. */
    duration: { type: 'number' },
    endsAt: { type: 'number' },
    remaining: { type: 'number' },
    endedAt: { type: 'number' },
    /** Stopwatch phases' fields. */
    startedAt: { type: 'number' },
    accumulated: { type: 'number' },
    /** A JSON array of numbers (cumulative splits); absent for timers and idle stopwatches. */
    laps: { type: 'string' },
  },
  presets: {
    name: { type: 'string' },
    duration: { type: 'number' },
    position: { type: 'number' },
  },
} as const satisfies TablesSchema

/** The values of the synced store: bookkeeping and the behavior settings, flattened. */
export const SYNCED_VALUES_SCHEMA = {
  schemaVersion: { type: 'number' },
  /** When the first-run seed ran; absent until then. */
  seededAt: { type: 'number' },
  timeStyle: { type: 'string' },
  hourCycle: { type: 'string' },
  /** A JSON array of three durations. */
  quickAdd: { type: 'string' },
  sound: { type: 'string' },
  volume: { type: 'number' },
  loop: { type: 'boolean' },
  autoStopMinutes: { type: 'number' },
  showOvertime: { type: 'boolean' },
  notifications: { type: 'boolean' },
  confirmDelete: { type: 'boolean' },
  /** A JSON object of keymap overrides. */
  keymap: { type: 'string' },
} as const satisfies ValuesSchema &
  Record<keyof settings.SyncedSettings | 'schemaVersion' | 'seededAt', unknown>

/** The device store has no tables (typing only: TinyBase treats an empty schema as none). */
export const DEVICE_TABLES_SCHEMA = {} as const satisfies TablesSchema

/** The values of the device store that hold the desktop settings, flattened. */
export const DESKTOP_VALUE_IDS = [
  'launchAtLogin',
  'closeBehavior',
  'miniAlwaysOnTop',
  'hotkeyToggleLast',
  'hotkeyShowApp',
] as const

/** The values of the device store that hold the desktop sign-in's bearer token. */
export const AUTH_VALUE_IDS = ['authToken', 'authExpiresAt'] as const

/**
 * The values of the device store: the appearance settings and the language, the desktop settings
 * (a hotkey's combo is `''` when it is unbound), and the bearer token (both values absent when
 * signed out).
 */
export const DEVICE_VALUES_SCHEMA = {
  schemaVersion: { type: 'number' },
  themeMode: { type: 'string' },
  seed: { type: 'string' },
  font: { type: 'string' },
  fontWeight: { type: 'number' },
  digitScale: { type: 'number' },
  ringScale: { type: 'number' },
  density: { type: 'string' },
  locale: { type: 'string' },
  launchAtLogin: { type: 'boolean' },
  closeBehavior: { type: 'string' },
  miniAlwaysOnTop: { type: 'boolean' },
  hotkeyToggleLast: { type: 'string' },
  hotkeyShowApp: { type: 'string' },
  authToken: { type: 'string' },
  authExpiresAt: { type: 'number' },
} as const satisfies ValuesSchema &
  Record<
    | keyof settings.DeviceSettings
    | (typeof DESKTOP_VALUE_IDS)[number]
    | (typeof AUTH_VALUE_IDS)[number]
    | 'schemaVersion',
    unknown
  >

export type SyncedSchemas = [typeof SYNCED_TABLES_SCHEMA, typeof SYNCED_VALUES_SCHEMA]
export type DeviceSchemas = [typeof DEVICE_TABLES_SCHEMA, typeof DEVICE_VALUES_SCHEMA]

/** A card's cells. Every cell is optional: rows come from merges and older or newer apps. */
export interface CardRow {
  kind?: string
  name?: string
  createdAt?: number
  muted?: boolean
  icon?: string
  position?: number
  phase?: string
  duration?: number
  endsAt?: number
  remaining?: number
  endedAt?: number
  startedAt?: number
  accumulated?: number
  laps?: string
}

/** A preset's cells. */
export interface PresetRow {
  name?: string
  duration?: number
  position?: number
}

/** The synced store's values, every one optional. */
export interface SyncedValues {
  schemaVersion?: number
  seededAt?: number
  timeStyle?: string
  hourCycle?: string
  quickAdd?: string
  sound?: string
  volume?: number
  loop?: boolean
  autoStopMinutes?: number
  showOvertime?: boolean
  notifications?: boolean
  confirmDelete?: boolean
  keymap?: string
}

/** The device store's values, every one optional. */
export interface DeviceValues {
  schemaVersion?: number
  themeMode?: string
  seed?: string
  font?: string
  fontWeight?: number
  digitScale?: number
  ringScale?: number
  density?: string
  locale?: string
  launchAtLogin?: boolean
  closeBehavior?: string
  miniAlwaysOnTop?: boolean
  hotkeyToggleLast?: string
  hotkeyShowApp?: string
  authToken?: string
  authExpiresAt?: number
}

/** The synced settings as values: every field present, the two structured ones as JSON. */
export type SyncedSettingsValues = Required<Omit<SyncedValues, 'schemaVersion' | 'seededAt'>>

/** The device settings as values: every field present. */
export type DeviceSettingsValues = Required<Pick<DeviceValues, keyof settings.DeviceSettings>>

/** The desktop settings as values: every field present, an unbound hotkey as `''`. */
export type DesktopSettingsValues = Required<Pick<DeviceValues, (typeof DESKTOP_VALUE_IDS)[number]>>

/** A bearer token as values. */
export type DeviceAuthValues = Required<Pick<DeviceValues, (typeof AUTH_VALUE_IDS)[number]>>

/** A clock reading: any finite number. */
function isTime(value: unknown): value is EpochMs {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A length of time as the engine stores it. */
const isSpan = timer.isSpan

/** A card name as the card model keeps it: trimmed, and the kind's default name when blank. */
const cardName = cards.cardName

/** Stopwatch laps from their cell: a JSON array of spans; anything else reads as no laps. */
function parseLaps(text: unknown): readonly Ms[] {
  if (typeof text !== 'string') return []
  let laps: unknown
  try {
    laps = JSON.parse(text)
  } catch {
    return []
  }
  return Array.isArray(laps) && laps.every(isSpan) ? laps : []
}

/** The cells of a timer state (a timer card always has `duration`). */
function timerCells(t: TimerState): CardRow {
  switch (t.phase) {
    case 'idle':
      return { phase: 'idle', duration: t.duration }
    case 'running':
      return { phase: 'running', duration: t.duration, endsAt: t.endsAt }
    case 'paused':
      return { phase: 'paused', duration: t.duration, remaining: t.remaining }
    case 'ringing':
      return { phase: 'ringing', duration: t.duration, endedAt: t.endedAt }
  }
}

/** The cells of a stopwatch state. */
function stopwatchCells(s: StopwatchState): CardRow {
  switch (s.phase) {
    case 'idle':
      return { phase: 'idle' }
    case 'running':
      return {
        phase: 'running',
        startedAt: s.startedAt,
        accumulated: s.accumulated,
        laps: JSON.stringify(s.laps),
      }
    case 'paused':
      return { phase: 'paused', accumulated: s.accumulated, laps: JSON.stringify(s.laps) }
  }
}

/**
 * The `cards` row for `card` at grid index `position`. Only the cells of the card's phase are
 * present, so writing the row with `setRow` also deletes the cells of its previous phase; the
 * `icon` cell likewise is present only while the card has an icon, so removing it deletes the
 * cell.
 *
 * Version 0.1.0 does not know the `icon` cell: it reads cards without it and writes the cells it
 * knows one by one (sync/cards-bridge), so it leaves an icon set on another device alone. Where
 * it writes a whole row (a delete it undoes, an import), the card comes back without its icon
 * until that device updates; acceptable, since people update all their devices.
 */
export function cardToRow(card: cards.Card, position: number): CardRow {
  const state = card.kind === 'timer' ? timerCells(card.timer) : stopwatchCells(card.stopwatch)
  return {
    kind: card.kind,
    name: card.name,
    createdAt: card.createdAt,
    muted: card.muted,
    ...(card.icon === undefined ? {} : { icon: card.icon }),
    position,
    ...state,
  }
}

/** A timer state from its cells; a phase whose fields are missing reads as idle. */
function rowToTimer(row: CardRow): TimerState {
  const duration = isSpan(row.duration) ? row.duration : cards.DEFAULT_TIMER_DURATION
  if (row.phase === 'running' && isTime(row.endsAt)) {
    return { phase: 'running', duration, endsAt: row.endsAt }
  }
  if (row.phase === 'paused' && isSpan(row.remaining)) {
    return { phase: 'paused', duration, remaining: row.remaining }
  }
  if (row.phase === 'ringing' && isTime(row.endedAt)) {
    return { phase: 'ringing', duration, endedAt: row.endedAt }
  }
  return { phase: 'idle', duration }
}

/** A stopwatch state from its cells; a phase whose fields are missing reads as idle. */
function rowToStopwatch(row: CardRow): StopwatchState {
  if (row.phase === 'running' && isTime(row.startedAt) && isSpan(row.accumulated)) {
    return {
      phase: 'running',
      startedAt: row.startedAt,
      accumulated: row.accumulated,
      laps: parseLaps(row.laps),
    }
  }
  if (row.phase === 'paused' && isSpan(row.accumulated)) {
    return { phase: 'paused', accumulated: row.accumulated, laps: parseLaps(row.laps) }
  }
  return { phase: 'idle' }
}

/**
 * The card stored in row `id`, or `null` when the row is not a card (no or an unknown `kind`, or
 * an empty id). Other cells fall back one by one: a blank name to the kind's default name, a bad
 * `createdAt` to 0, `muted` to false, an icon that is not an emoji (`cards.isCardIcon`) to none,
 * a timer's bad duration to 5:00, a phase whose fields are missing to idle, and unreadable laps
 * to none. Cells of other phases are ignored.
 */
export function rowToCard(id: cards.CardId, row: CardRow): cards.Card | null {
  const kind = row.kind
  if (id === '' || (kind !== 'timer' && kind !== 'stopwatch')) return null
  const name = cardName(row.name, kind)
  const createdAt = isTime(row.createdAt) ? row.createdAt : 0
  const muted = row.muted === true
  const icon = cards.isCardIcon(row.icon) ? { icon: row.icon } : {}
  return kind === 'timer'
    ? { id, kind, name, createdAt, muted, ...icon, timer: rowToTimer(row) }
    : { id, kind, name, createdAt, muted, ...icon, stopwatch: rowToStopwatch(row) }
}

/** Whether two rows hold exactly the same cells. */
export function sameRow<Row extends object>(a: Row, b: Row): boolean {
  const aKeys = Object.keys(a) as (keyof Row)[]
  if (aKeys.length !== Object.keys(b).length) return false
  return aKeys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
}

/** Whether two cards store the same cells, i.e. are the same card in the same state. */
export function sameCard(a: cards.Card, b: cards.Card): boolean {
  return a.id === b.id && sameRow(cardToRow(a, 0), cardToRow(b, 0))
}

/** An item read from a table, with the position its row stores (NaN when it has none). */
export interface Positioned<Item> {
  readonly item: Item
  readonly position: number
}

/** The row's position for sorting: rows without one go last. */
function sortPosition(position: number): number {
  return Number.isNaN(position) ? Number.POSITIVE_INFINITY : position
}

/** Plain string order (not the locale's), so every device sorts ties alike. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The position cell of a row, or NaN when it has none. */
function rowPosition(position: unknown): number {
  return isTime(position) ? position : Number.NaN
}

/**
 * The cards of a `cards` table in grid order: by position, then `createdAt`, then id (rows a merge
 * left without a position go last). Rows that are not cards are skipped.
 */
export function cardsFromTable(table: Readonly<Record<string, CardRow>>): Positioned<cards.Card>[] {
  const out: Positioned<cards.Card>[] = []
  for (const [id, row] of Object.entries(table)) {
    const card = rowToCard(id, row)
    if (card !== null) out.push({ item: card, position: rowPosition(row.position) })
  }
  return out.sort(
    (a, b) =>
      sortPosition(a.position) - sortPosition(b.position) ||
      a.item.createdAt - b.item.createdAt ||
      compareIds(a.item.id, b.item.id),
  )
}

/** The `presets` row for `preset` at list index `position`. */
export function presetToRow(preset: Preset, position: number): PresetRow {
  return { name: preset.name, duration: preset.duration, position }
}

/**
 * The preset stored in row `id`, or `null` when it is not usable: an empty id, a blank name, or a
 * duration that is not a positive span. The name comes back trimmed.
 */
export function rowToPreset(id: string, row: PresetRow): Preset | null {
  const name = typeof row.name === 'string' ? presetName(row.name) : null
  const duration = row.duration
  if (id === '' || name === null || duration === undefined || !isPresetDuration(duration)) {
    return null
  }
  return { id, name, duration }
}

/** The presets of a `presets` table in order: by position, then id. Unusable rows are skipped. */
export function presetsFromTable(table: Readonly<Record<string, PresetRow>>): Positioned<Preset>[] {
  const out: Positioned<Preset>[] = []
  for (const [id, row] of Object.entries(table)) {
    const preset = rowToPreset(id, row)
    if (preset !== null) out.push({ item: preset, position: rowPosition(row.position) })
  }
  return out.sort(
    (a, b) =>
      sortPosition(a.position) - sortPosition(b.position) || compareIds(a.item.id, b.item.id),
  )
}

/**
 * The values of `next` that differ from `current` (compared with `Object.is`), or `null` when none
 * does; what a settings update writes.
 */
export function changedValues<Values extends object>(
  current: Values,
  next: Values,
): Partial<Values> | null {
  let changed: Partial<Values> | null = null
  for (const id of Object.keys(next) as (keyof Values)[]) {
    if (Object.is(next[id], current[id])) continue
    changed ??= {}
    changed[id] = next[id]
  }
  return changed
}

/** Parses a JSON value cell; text that is not JSON (or no text) reads as `undefined`. */
function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** The stored schema version, when it is a usable one. */
function storedVersion(version: number | undefined): number | undefined {
  return version !== undefined && Number.isInteger(version) && version >= 1 ? version : undefined
}

/** The synced settings as values to store. */
export function syncedSettingsToValues(s: settings.SyncedSettings): SyncedSettingsValues {
  return {
    timeStyle: s.timeStyle,
    hourCycle: s.hourCycle,
    quickAdd: JSON.stringify(s.quickAdd),
    sound: s.sound,
    volume: s.volume,
    loop: s.loop,
    autoStopMinutes: s.autoStopMinutes,
    showOvertime: s.showOvertime,
    notifications: s.notifications,
    confirmDelete: s.confirmDelete,
    keymap: JSON.stringify(s.keymap),
  }
}

/**
 * Reuses `previous` where `next` has the same content: its `quickAdd` and `keymap` objects when
 * they hold the same values, and the whole object when every field matches, so `===` detects "no
 * change" and `settings.bindingsWith` keeps hitting its per-object cache.
 */
function stableSynced(
  next: settings.SyncedSettings,
  previous: settings.SyncedSettings | undefined,
): settings.SyncedSettings {
  if (previous === undefined) return next
  const quickAdd = sameJson(next.quickAdd, previous.quickAdd) ? previous.quickAdd : next.quickAdd
  const keymap = sameJson(next.keymap, previous.keymap) ? previous.keymap : next.keymap
  const merged = Object.freeze({ ...next, quickAdd, keymap })
  return sameRow(merged, previous) ? previous : merged
}

function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * The synced settings that `values` hold: validated and completed by
 * `settings.migrateSyncedSettings` (upgrading data of an older `schemaVersion`), so missing and
 * invalid values read as their defaults. Pass the previous result as `previous` to get it back
 * (or its `quickAdd` and `keymap` objects) when nothing in it changed.
 */
export function valuesToSyncedSettings(
  values: SyncedValues,
  previous?: settings.SyncedSettings,
): settings.SyncedSettings {
  const input = {
    timeStyle: values.timeStyle,
    hourCycle: values.hourCycle,
    quickAdd: parseJson(values.quickAdd),
    sound: values.sound,
    volume: values.volume,
    loop: values.loop,
    autoStopMinutes: values.autoStopMinutes,
    showOvertime: values.showOvertime,
    notifications: values.notifications,
    confirmDelete: values.confirmDelete,
    keymap: parseJson(values.keymap),
  }
  const next = settings.migrateSyncedSettings(input, storedVersion(values.schemaVersion))
  return stableSynced(next, previous)
}

/** The device settings as values to store. */
export function deviceSettingsToValues(d: settings.DeviceSettings): DeviceSettingsValues {
  return {
    themeMode: d.themeMode,
    seed: d.seed,
    font: d.font,
    fontWeight: d.fontWeight,
    digitScale: d.digitScale,
    ringScale: d.ringScale,
    density: d.density,
    locale: d.locale,
  }
}

/**
 * The device settings that `values` hold, as for {@link valuesToSyncedSettings}; `previous` comes
 * back when nothing changed.
 */
export function valuesToDeviceSettings(
  values: DeviceValues,
  previous?: settings.DeviceSettings,
): settings.DeviceSettings {
  const { schemaVersion, ...fields } = values
  const next = settings.migrateDeviceSettings(fields, storedVersion(schemaVersion))
  return previous !== undefined && sameRow(next, previous) ? previous : next
}

/** The desktop settings as values to store; an unbound hotkey is `''`. */
export function desktopSettingsToValues(d: settings.DesktopSettings): DesktopSettingsValues {
  return {
    launchAtLogin: d.launchAtLogin,
    closeBehavior: d.closeBehavior,
    miniAlwaysOnTop: d.miniAlwaysOnTop,
    hotkeyToggleLast: d.hotkeys.toggleLast ?? '',
    hotkeyShowApp: d.hotkeys.showApp ?? '',
  }
}

/**
 * The desktop settings that `values` hold, validated and completed by
 * `settings.migrateDesktopSettings`: missing and invalid values read as their defaults, and an
 * empty (or invalid) combo as an unbound hotkey. `previous` comes back when nothing changed, and
 * its `hotkeys` object when the hotkeys did not.
 */
export function valuesToDesktopSettings(
  values: DeviceValues,
  previous?: settings.DesktopSettings,
): settings.DesktopSettings {
  const next = settings.migrateDesktopSettings(
    {
      launchAtLogin: values.launchAtLogin,
      closeBehavior: values.closeBehavior,
      miniAlwaysOnTop: values.miniAlwaysOnTop,
      hotkeys: { toggleLast: values.hotkeyToggleLast, showApp: values.hotkeyShowApp },
    },
    storedVersion(values.schemaVersion),
  )
  if (previous === undefined) return next
  const hotkeys = sameRow(next.hotkeys, previous.hotkeys) ? previous.hotkeys : next.hotkeys
  const merged = Object.freeze({ ...next, hotkeys })
  return sameRow(merged, previous) ? previous : merged
}

/** A bearer token as values to store. */
export function deviceAuthToValues(auth: settings.DeviceAuth): DeviceAuthValues {
  return { authToken: auth.token, authExpiresAt: auth.expiresAt }
}

/**
 * The bearer token that `values` hold, or null when there is none or it is not usable (see
 * `settings.migrateDeviceAuth`). `previous` comes back when it holds the same token and expiry.
 */
export function valuesToDeviceAuth(
  values: DeviceValues,
  previous?: settings.DeviceAuth | null,
): settings.DeviceAuth | null {
  const next = settings.migrateDeviceAuth({
    token: values.authToken,
    expiresAt: values.authExpiresAt,
  })
  return next !== null && previous != null && sameRow(next, previous) ? previous : next
}
