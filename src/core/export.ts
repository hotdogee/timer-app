/**
 * The export file: everything the user owns (cards, presets and both settings groups) as one
 * JSON document, and the validation that reads such a file back for Import (spec.md › Settings ›
 * Data). Pure: building the download and reading the picked file happen in the UI.
 *
 * {@link parseExport} never throws. It rejects a file that is not one of ours, comes from a newer
 * app, or holds a card or preset that does not fit the engine's shapes; settings are read
 * leniently, field by field, like stored settings. Cards come back exactly as stored, so a running
 * timer whose end passed while the file sat on disk is still `running`: the importer settles the
 * cards at the current time (`cards.settleAll`), as it does after loading from storage.
 */
import * as v from 'valibot'

import { cardName, isCardIcon, type Card } from './card'
import {
  migrateDeviceSettings,
  migrateSyncedSettings,
  type DeviceSettings,
  type SyncedSettings,
} from './settings'
import { MAX_MS } from './timer'
import type { EpochMs, Ms } from './types'

/** The `app` field that marks a file as ours. */
export const EXPORT_APP = 'timer-app'

/** The version of the file layout this app writes; files of a later version are refused. */
export const EXPORT_FORMAT = 1

/** The longest file text {@link parseExport} reads (characters), and the most cards and presets. */
export const MAX_EXPORT_LENGTH = 5_000_000
export const MAX_EXPORT_CARDS = 1000
export const MAX_EXPORT_PRESETS = 1000

/** A preset as the file stores it: the same shape as `Preset` in `src/state/presets.ts`. */
export interface ExportPreset {
  readonly id: string
  readonly name: string
  readonly duration: Ms
}

/** The settings in a file: both groups, so Import restores this device's appearance too. */
export interface ExportSettings {
  readonly synced: SyncedSettings
  readonly device: DeviceSettings
}

/** A whole export file. Cards and presets are in display order. */
export interface ExportData {
  readonly app: typeof EXPORT_APP
  readonly format: typeof EXPORT_FORMAT
  /** When the file was written. */
  readonly exportedAt: EpochMs
  readonly cards: readonly Card[]
  readonly presets: readonly ExportPreset[]
  readonly settings: ExportSettings
}

/**
 * Why a file cannot be imported, for the UI to explain in the user's language:
 * - `too-large`: more than {@link MAX_EXPORT_LENGTH} characters, cards or presets;
 * - `not-json`: not JSON text (or not text at all);
 * - `not-export`: JSON, but not a Timer App export;
 * - `newer-format`: written by a newer version of the app;
 * - `invalid`: ours, but a card, a preset or the format number is malformed.
 */
export type ExportErrorReason = 'too-large' | 'not-json' | 'not-export' | 'newer-format' | 'invalid'

/** Every {@link ExportErrorReason}, e.g. to check that each has a message. */
export const EXPORT_ERROR_REASONS: readonly ExportErrorReason[] = Object.freeze([
  'too-large',
  'not-json',
  'not-export',
  'newer-format',
  'invalid',
])

/** The outcome of {@link parseExport}. */
export type ParseExportResult =
  | { readonly ok: true; readonly data: ExportData }
  | {
      readonly ok: false
      readonly reason: ExportErrorReason
      /** Where an `invalid` file goes wrong, e.g. `cards.2.timer.endsAt`; for logs, not users. */
      readonly path?: string
    }

/** What {@link createExport} needs: the app's current data. */
export interface ExportContent {
  readonly exportedAt: EpochMs
  readonly cards: readonly Card[]
  readonly presets: readonly ExportPreset[]
  readonly settings: ExportSettings
}

/**
 * The export file for `content`. Presets are reduced to their exported fields, so extra fields a
 * caller's objects carry stay out of the file.
 */
export function createExport(content: ExportContent): ExportData {
  return {
    app: EXPORT_APP,
    format: EXPORT_FORMAT,
    exportedAt: content.exportedAt,
    cards: content.cards,
    presets: content.presets.map(({ id, name, duration }) => ({ id, name, duration })),
    settings: { synced: content.settings.synced, device: content.settings.device },
  }
}

/** The file text: indented JSON with a final newline. */
export function stringifyExport(data: ExportData): string {
  return `${JSON.stringify(data, null, 2)}\n`
}

/**
 * The download's file name, `timer-app-YYYY-MM-DD.json`, dated `at` in `timeZone` (an IANA name;
 * omitted or unknown means the runtime's zone). A time that is not a valid date gives
 * `timer-app.json`.
 */
export function exportFileName(at: EpochMs, timeZone?: string): string {
  // NaN, ±Infinity and times past the reach of a Date make an Invalid Date.
  if (Number.isNaN(new Date(at).getTime())) return `${EXPORT_APP}.json`
  const options = { year: 'numeric', month: '2-digit', day: '2-digit' } as const
  let format: Intl.DateTimeFormat
  try {
    format = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
  } catch {
    format = new Intl.DateTimeFormat('en-US', options)
  }
  // Parts, not the formatted string: the field order and separators differ between locales.
  const parts = new Map(format.formatToParts(at).map((part) => [part.type, part.value]))
  const field = (type: Intl.DateTimeFormatPartTypes): string => String(parts.get(type))
  return `${EXPORT_APP}-${field('year')}-${field('month')}-${field('day')}.json`
}

/** The longest id kept from a file; app ids are UUIDs. */
const MAX_ID_LENGTH = 256

/** A clock reading: any finite number. */
const time = v.pipe(v.number(), v.finite())
/** A length of time as the engine stores it: finite, 0 to `MAX_MS` (timer.ts). */
const span = v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(MAX_MS))
const id = v.pipe(v.string(), v.minLength(1), v.maxLength(MAX_ID_LENGTH))

/** `TimerState` in types.ts, phase by phase. */
const timerState = v.variant('phase', [
  v.object({ phase: v.literal('idle'), duration: span }),
  v.object({ phase: v.literal('running'), duration: span, endsAt: time }),
  v.object({ phase: v.literal('paused'), duration: span, remaining: span }),
  v.object({ phase: v.literal('ringing'), duration: span, endedAt: time }),
])

/** `StopwatchState` in types.ts, phase by phase. */
const laps = v.array(span)
const stopwatchState = v.variant('phase', [
  v.object({ phase: v.literal('idle') }),
  v.object({ phase: v.literal('running'), startedAt: time, accumulated: span, laps }),
  v.object({ phase: v.literal('paused'), accumulated: span, laps }),
])

/**
 * `Card` in card.ts. The icon is optional and, when present, an emoji: files without it (format
 * 1 from 0.1.0) still read, and 0.1.0 reading a newer file drops it as an unknown field.
 * `exactOptional`, so a card read back has no `icon` key rather than `icon: undefined`.
 */
const icon = v.pipe(
  v.string(),
  v.check((text: string) => isCardIcon(text)),
)
const cardFields = {
  id,
  name: v.string(),
  createdAt: time,
  muted: v.boolean(),
  icon: v.exactOptional(icon),
}
const card = v.variant('kind', [
  v.object({ ...cardFields, kind: v.literal('timer'), timer: timerState }),
  v.object({ ...cardFields, kind: v.literal('stopwatch'), stopwatch: stopwatchState }),
])

const preset = v.object({
  id,
  name: v.pipe(v.string(), v.trim(), v.minLength(1)),
  duration: v.pipe(v.number(), v.finite(), v.gtValue(0), v.maxValue(MAX_MS)),
})

/** The items after the first with each id dropped, as `cards.normalizeList` does for cards. */
function firstOfEachId<T extends { readonly id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The value of own property `key`, so names like `constructor` never read the prototype. */
function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** An `invalid` result pointing at the first issue, under `prefix` (the field validated). */
function invalid(
  issues: readonly [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]],
  prefix: string,
): ParseExportResult {
  const path = v.getDotPath(issues[0])
  return { ok: false, reason: 'invalid', path: path === null ? prefix : `${prefix}.${path}` }
}

/**
 * Reads export file text back into data, or says why it cannot. Settings fields that are
 * missing or invalid fall back to their defaults (missing groups too); later cards or presets
 * that repeat an earlier id are dropped; card names are trimmed, a blank one becoming the
 * default name. Unknown fields are dropped everywhere.
 */
export function parseExport(text: string): ParseExportResult {
  if (typeof text !== 'string') return { ok: false, reason: 'not-json' }
  if (text.length > MAX_EXPORT_LENGTH) return { ok: false, reason: 'too-large' }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'not-json' }
  }
  if (!isRecord(json) || own(json, 'app') !== EXPORT_APP) return { ok: false, reason: 'not-export' }

  const format = own(json, 'format')
  if (typeof format !== 'number' || !Number.isInteger(format) || format < 1) {
    return { ok: false, reason: 'invalid', path: 'format' }
  }
  if (format > EXPORT_FORMAT) return { ok: false, reason: 'newer-format' }

  const rawCards = own(json, 'cards')
  const rawPresets = own(json, 'presets')
  if (Array.isArray(rawCards) && rawCards.length > MAX_EXPORT_CARDS) {
    return { ok: false, reason: 'too-large' }
  }
  if (Array.isArray(rawPresets) && rawPresets.length > MAX_EXPORT_PRESETS) {
    return { ok: false, reason: 'too-large' }
  }
  const cards = v.safeParse(v.array(card), rawCards)
  if (!cards.success) return invalid(cards.issues, 'cards')
  const presets = v.safeParse(v.array(preset), rawPresets)
  if (!presets.success) return invalid(presets.issues, 'presets')

  const exportedAt = own(json, 'exportedAt')
  const settings = own(json, 'settings')
  const group = (key: string): unknown => (isRecord(settings) ? own(settings, key) : undefined)
  // Format 1 holds settings of schema version 1; map formats to settings versions here when
  // either changes.
  const settingsVersion = format
  return {
    ok: true,
    data: {
      app: EXPORT_APP,
      format: EXPORT_FORMAT,
      exportedAt: typeof exportedAt === 'number' && Number.isFinite(exportedAt) ? exportedAt : 0,
      cards: firstOfEachId(cards.output).map((c) => ({ ...c, name: cardName(c.name, c.kind) })),
      presets: firstOfEachId(presets.output),
      settings: {
        synced: migrateSyncedSettings(group('synced'), settingsVersion),
        device: migrateDeviceSettings(group('device'), settingsVersion),
      },
    },
  }
}
