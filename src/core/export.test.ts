import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { Preset } from '../state/presets'
import { settleAll, type Card } from './card'
import {
  createExport,
  EXPORT_APP,
  EXPORT_ERROR_REASONS,
  EXPORT_FORMAT,
  exportFileName,
  MAX_EXPORT_CARDS,
  MAX_EXPORT_LENGTH,
  MAX_EXPORT_PRESETS,
  parseExport,
  stringifyExport,
  type ExportContent,
  type ExportData,
  type ExportErrorReason,
  type ExportPreset,
  type ParseExportResult,
} from './export'
import {
  DENSITIES,
  DEVICE_DEFAULTS,
  FONT_IDS,
  HOUR_CYCLES,
  LOCALES,
  SOUND_IDS,
  SYNCED_DEFAULTS,
  THEME_MODES,
  TIME_STYLES,
  type DeviceSettings,
  type SyncedSettings,
} from './settings'

const SECOND = 1000
const MINUTE = 60 * SECOND

/** 14:47 UTC on 2026-10-17. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

const TIMER: Card = {
  id: 'a1',
  kind: 'timer',
  name: 'Tea',
  createdAt: NOW - MINUTE,
  muted: false,
  timer: { phase: 'running', duration: 3 * MINUTE, endsAt: NOW + 2 * MINUTE },
}
const STOPWATCH: Card = {
  id: 'b2',
  kind: 'stopwatch',
  name: 'Laps',
  createdAt: NOW - 2 * MINUTE,
  muted: true,
  stopwatch: { phase: 'paused', accumulated: 95_000, laps: [30_000, 61_500] },
}
const TEA: ExportPreset = { id: 'tea', name: 'Tea', duration: 3 * MINUTE }
const PRESETS: readonly ExportPreset[] = [TEA, { id: 'p-1', name: 'Pasta', duration: 9 * MINUTE }]
const CONTENT: ExportContent = {
  exportedAt: NOW,
  cards: [TIMER, STOPWATCH],
  presets: PRESETS,
  settings: {
    synced: { ...SYNCED_DEFAULTS, timeStyle: 'fixed', keymap: { reset: ['x'] } },
    device: { ...DEVICE_DEFAULTS, themeMode: 'dark', locale: 'ja' },
  },
}

/** The text of a file with `changes` applied on top of {@link CONTENT}'s export. */
function fileWith(changes: Record<string, unknown>): string {
  return JSON.stringify({ ...createExport(CONTENT), ...changes })
}

/** The data of a result that must be ok. */
function ok(result: ParseExportResult): ExportData {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason} at ${result.path ?? '-'}`)
  return result.data
}

/** The failure of a result that must have failed. */
function failure(result: ParseExportResult): { reason: ExportErrorReason; path?: string } {
  if (result.ok) throw new Error('expected a failure')
  return result.path === undefined
    ? { reason: result.reason }
    : { reason: result.reason, path: result.path }
}

describe('createExport', () => {
  it('marks the file as ours and keeps the content', () => {
    const data = createExport(CONTENT)
    expect(data).toEqual({ app: 'timer-app', format: 1, ...CONTENT })
    expect(data.app).toBe(EXPORT_APP)
    expect(data.format).toBe(EXPORT_FORMAT)
    expect(data.cards).toBe(CONTENT.cards)
  })

  it('writes only the exported fields of presets', () => {
    const withExtras = [{ ...TEA, position: 4, builtIn: true }]
    expect(createExport({ ...CONTENT, presets: withExtras }).presets).toEqual([TEA])
  })

  it("accepts the app's Preset type", () => {
    expectTypeOf<Preset>().toExtend<ExportPreset>()
    expectTypeOf<ExportPreset>().toExtend<Preset>()
  })
})

describe('stringifyExport', () => {
  it('writes indented JSON with a final newline', () => {
    const text = stringifyExport(createExport(CONTENT))
    expect(text.endsWith('}\n')).toBe(true)
    expect(text.startsWith('{\n  "app": "timer-app",\n  "format": 1,\n')).toBe(true)
    expect(JSON.parse(text)).toEqual(createExport(CONTENT))
  })
})

describe('exportFileName', () => {
  it('dates the file in the given time zone, zero-padded', () => {
    expect(exportFileName(NOW, 'UTC')).toBe('timer-app-2026-10-17.json')
    expect(exportFileName(Date.UTC(2026, 0, 2, 3), 'UTC')).toBe('timer-app-2026-01-02.json')
    // 20:00 UTC is already the next day in Taipei (UTC+8) and still the same day in Los Angeles.
    const evening = Date.UTC(2026, 9, 17, 20)
    expect(exportFileName(evening, 'Asia/Taipei')).toBe('timer-app-2026-10-18.json')
    expect(exportFileName(evening, 'America/Los_Angeles')).toBe('timer-app-2026-10-17.json')
  })

  it("uses the runtime's zone when none or an unknown one is given", () => {
    const local = exportFileName(NOW)
    expect(local).toMatch(/^timer-app-\d{4}-\d{2}-\d{2}\.json$/)
    expect(exportFileName(NOW, 'Mars/Olympus_Mons')).toBe(local)
  })

  it('falls back to a plain name for times that are not dates', () => {
    for (const at of [NaN, Infinity, -Infinity, 8.64e15 + 1]) {
      expect(exportFileName(at, 'UTC')).toBe('timer-app.json')
    }
  })
})

describe('parseExport', () => {
  it('reads back what createExport and stringifyExport wrote', () => {
    const data = createExport(CONTENT)
    expect(ok(parseExport(stringifyExport(data)))).toEqual(data)
    expect(ok(parseExport(JSON.stringify(data)))).toEqual(data)
  })

  it('reads an empty install back', () => {
    const empty = createExport({
      exportedAt: 0,
      cards: [],
      presets: [],
      settings: { synced: SYNCED_DEFAULTS, device: DEVICE_DEFAULTS },
    })
    expect(ok(parseExport(stringifyExport(empty)))).toEqual(empty)
  })

  it('reads a card’s icon back, and cards without one stay without', () => {
    const withIcon: Card = { ...STOPWATCH, icon: '🏃' }
    const data = ok(parseExport(fileWith({ cards: [TIMER, withIcon] })))
    expect(data.cards).toEqual([TIMER, withIcon])
    expect(data.cards[0]).not.toHaveProperty('icon')
  })

  it('leaves cards as stored; settling them is the importer’s job', () => {
    const data = ok(parseExport(fileWith({})))
    expect(data.cards[0]).toEqual(TIMER)
    const later = settleAll({ cards: data.cards, selectedId: null }, NOW + 10 * MINUTE)
    expect(later.cards[0]).toMatchObject({ timer: { phase: 'ringing', endedAt: NOW + 2 * MINUTE } })
  })

  describe('refuses', () => {
    it('text that is not a string', () => {
      const junks: unknown[] = [undefined, null, 42, {}, new ArrayBuffer(4)]
      for (const junk of junks) {
        expect(failure(parseExport(junk as string))).toEqual({ reason: 'not-json' })
      }
    })

    it('text longer than the limit, before parsing it', () => {
      const huge = `{"app":"timer-app","format":1,"pad":"${'x'.repeat(MAX_EXPORT_LENGTH)}"}`
      expect(failure(parseExport(huge))).toEqual({ reason: 'too-large' })
      expect(failure(parseExport('x'.repeat(MAX_EXPORT_LENGTH)))).toEqual({ reason: 'not-json' })
    })

    it('more cards or presets than the limits', () => {
      const cards = Array.from({ length: MAX_EXPORT_CARDS + 1 }, (_, i) => ({
        ...TIMER,
        id: `c${i}`,
      }))
      expect(failure(parseExport(fileWith({ cards })))).toEqual({ reason: 'too-large' })
      expect(ok(parseExport(fileWith({ cards: cards.slice(1) }))).cards).toHaveLength(
        MAX_EXPORT_CARDS,
      )
      const presets = Array.from({ length: MAX_EXPORT_PRESETS + 1 }, (_, i) => ({
        id: `p${i}`,
        name: 'P',
        duration: MINUTE,
      }))
      expect(failure(parseExport(fileWith({ presets })))).toEqual({ reason: 'too-large' })
    })

    it('text that is not JSON, including a truncated file', () => {
      const text = stringifyExport(createExport(CONTENT))
      for (const bad of ['', '   ', '{', 'timer-app', "{'app':'timer-app'}", text.slice(0, -10)]) {
        expect(failure(parseExport(bad))).toEqual({ reason: 'not-json' })
      }
    })

    it('deeply nested JSON without throwing', () => {
      const deep = `${'['.repeat(100_000)}${']'.repeat(100_000)}`
      expect(parseExport(deep).ok).toBe(false)
    })

    it('JSON that is not one of our exports', () => {
      const others = [
        'null',
        '42',
        '"timer-app"',
        '[]',
        '{}',
        '[{"app":"timer-app"}]',
        '{"app":"other-app","format":1}',
        '{"app":"Timer-App","format":1}',
        '{"__proto__":{"app":"timer-app"},"format":1}',
      ]
      for (const text of others)
        expect(failure(parseExport(text)), text).toEqual({ reason: 'not-export' })
    })

    it('a malformed format number', () => {
      for (const format of [undefined, null, '1', 0, -1, 1.5, true]) {
        expect(failure(parseExport(fileWith({ format })))).toEqual({
          reason: 'invalid',
          path: 'format',
        })
      }
    })

    it('a file from a newer app', () => {
      expect(failure(parseExport(fileWith({ format: 2 })))).toEqual({ reason: 'newer-format' })
    })

    it('missing card or preset lists', () => {
      for (const cards of [undefined, null, 'x', { 0: TIMER }]) {
        expect(failure(parseExport(fileWith({ cards })))).toEqual({
          reason: 'invalid',
          path: 'cards',
        })
      }
      expect(failure(parseExport(fileWith({ presets: undefined })))).toEqual({
        reason: 'invalid',
        path: 'presets',
      })
    })

    // [what, broken card, path of the first problem under cards.0]
    const brokenCards: [string, Record<string, unknown>, string][] = [
      ['an unknown kind', { ...TIMER, kind: 'alarm' }, 'kind'],
      ['a missing id', { ...TIMER, id: undefined }, 'id'],
      ['an empty id', { ...TIMER, id: '' }, 'id'],
      ['an overlong id', { ...TIMER, id: 'x'.repeat(257) }, 'id'],
      ['a numeric id', { ...TIMER, id: 7 }, 'id'],
      ['a missing name', { ...TIMER, name: undefined }, 'name'],
      ['a creation time that is not a number', { ...TIMER, createdAt: '2026' }, 'createdAt'],
      ['a mute flag that is not a boolean', { ...TIMER, muted: 0 }, 'muted'],
      ['an icon that is not an emoji', { ...TIMER, icon: 'tea' }, 'icon'],
      ['an empty icon', { ...TIMER, icon: '' }, 'icon'],
      ['an icon that is not a string', { ...TIMER, icon: 7 }, 'icon'],
      ['an icon set to null', { ...TIMER, icon: null }, 'icon'],
      ['a timer without its state', { ...TIMER, timer: undefined }, 'timer'],
      ['a timer with a stopwatch state', { ...TIMER, timer: { phase: 'idle' } }, 'timer.duration'],
      [
        'an unknown timer phase',
        { ...TIMER, timer: { phase: 'snoozed', duration: 1 } },
        'timer.phase',
      ],
      [
        'a running timer without its end',
        { ...TIMER, timer: { phase: 'running', duration: MINUTE } },
        'timer.endsAt',
      ],
      [
        'a paused timer without the time left',
        { ...TIMER, timer: { phase: 'paused', duration: MINUTE } },
        'timer.remaining',
      ],
      [
        'a ringing timer without its end',
        { ...TIMER, timer: { phase: 'ringing', duration: MINUTE, endsAt: NOW } },
        'timer.endedAt',
      ],
      [
        'a negative duration',
        { ...TIMER, timer: { phase: 'idle', duration: -1 } },
        'timer.duration',
      ],
      [
        'a duration past the engine limit',
        { ...TIMER, timer: { phase: 'idle', duration: 9e15 } },
        'timer.duration',
      ],
      [
        'a negative time left',
        { ...TIMER, timer: { phase: 'paused', duration: MINUTE, remaining: -5 } },
        'timer.remaining',
      ],
      [
        'a stopwatch with a timer state',
        {
          ...STOPWATCH,
          stopwatch: { phase: 'idle', duration: 5 },
          timer: undefined,
          kind: 'timer',
        },
        'timer',
      ],
      [
        'a running stopwatch without its start',
        { ...STOPWATCH, stopwatch: { phase: 'running', accumulated: 0, laps: [] } },
        'stopwatch.startedAt',
      ],
      [
        'a negative lap',
        { ...STOPWATCH, stopwatch: { phase: 'paused', accumulated: 5, laps: [1, -2] } },
        'stopwatch.laps.1',
      ],
      [
        'laps that are not a list',
        { ...STOPWATCH, stopwatch: { phase: 'paused', accumulated: 5, laps: '1,2' } },
        'stopwatch.laps',
      ],
    ]

    it.each(brokenCards)('a card with %s', (_, card, path) => {
      const result = parseExport(fileWith({ cards: [TIMER, card] }))
      expect(failure(result)).toEqual({ reason: 'invalid', path: `cards.1.${path}` })
    })

    it('a first card with an invalid icon, at its path', () => {
      expect(failure(parseExport(fileWith({ cards: [{ ...TIMER, icon: 'abc' }] })))).toEqual({
        reason: 'invalid',
        path: 'cards.0.icon',
      })
    })

    it('a card that is not an object', () => {
      for (const card of [null, 'Tea', 42]) {
        expect(failure(parseExport(fileWith({ cards: [card] })))).toEqual({
          reason: 'invalid',
          path: 'cards.0',
        })
      }
      // An array is an object without a kind.
      expect(failure(parseExport(fileWith({ cards: [[]] })))).toEqual({
        reason: 'invalid',
        path: 'cards.0.kind',
      })
    })

    it('a preset with a blank name, a bad duration or a bad id', () => {
      const broken: [Record<string, unknown>, string][] = [
        [{ id: 'p', name: '  ', duration: MINUTE }, 'name'],
        [{ id: 'p', name: 7, duration: MINUTE }, 'name'],
        [{ id: 'p', name: 'P', duration: 0 }, 'duration'],
        [{ id: 'p', name: 'P', duration: -MINUTE }, 'duration'],
        [{ id: 'p', name: 'P', duration: '3:00' }, 'duration'],
        [{ id: 'p', name: 'P', duration: 9e15 }, 'duration'],
        [{ id: '', name: 'P', duration: MINUTE }, 'id'],
        [{ name: 'P', duration: MINUTE }, 'id'],
      ]
      for (const [preset, path] of broken) {
        expect(failure(parseExport(fileWith({ presets: [preset] })))).toEqual({
          reason: 'invalid',
          path: `presets.0.${path}`,
        })
      }
    })
  })

  describe('repairs and leniency', () => {
    it('drops unknown fields at every level', () => {
      const data = ok(
        parseExport(
          fileWith({
            extra: true,
            cards: [
              { ...TIMER, color: 'red', timer: { ...TIMER.timer, snoozes: 2 } },
              { ...STOPWATCH, stopwatch: { phase: 'idle', laps: [] } },
            ],
            presets: [{ ...TEA, position: 3 }],
            settings: {
              synced: { ...CONTENT.settings.synced, theme: 'dark' },
              device: { ...CONTENT.settings.device, wallpaper: 'x' },
              account: {},
            },
          }),
        ),
      )
      expect(data).toEqual(
        createExport({
          ...CONTENT,
          cards: [TIMER, { ...STOPWATCH, stopwatch: { phase: 'idle' } }],
          presets: [TEA],
        }),
      )
    })

    it('keeps the first card or preset with each id', () => {
      const data = ok(
        parseExport(
          fileWith({
            cards: [TIMER, { ...STOPWATCH, id: TIMER.id }, STOPWATCH],
            presets: [PRESETS[0], { ...PRESETS[1], id: 'tea' }, PRESETS[1]],
          }),
        ),
      )
      expect(data.cards).toEqual([TIMER, STOPWATCH])
      expect(data.presets).toEqual(PRESETS)
    })

    it('trims names, and gives a blank card name its default', () => {
      const data = ok(
        parseExport(
          fileWith({
            cards: [
              { ...TIMER, name: '  Tea  ' },
              { ...STOPWATCH, name: ' \t ' },
              { ...TIMER, id: 'c3', name: '' },
            ],
            presets: [{ ...TEA, name: ' Tea\n' }],
          }),
        ),
      )
      expect(data.cards.map((c) => c.name)).toEqual(['Tea', 'Stopwatch', 'Timer'])
      expect(data.presets[0]?.name).toBe('Tea')
    })

    it('fills missing or invalid settings with defaults, field by field', () => {
      expect(ok(parseExport(fileWith({ settings: undefined }))).settings).toEqual({
        synced: SYNCED_DEFAULTS,
        device: DEVICE_DEFAULTS,
      })
      for (const settings of [null, 'x', [], { synced: 'x', device: 42 }]) {
        expect(ok(parseExport(fileWith({ settings }))).settings).toEqual({
          synced: SYNCED_DEFAULTS,
          device: DEVICE_DEFAULTS,
        })
      }
      const partial = ok(
        parseExport(
          fileWith({
            settings: { synced: { volume: 3, sound: 'gong' }, device: { font: 'inter' } },
          }),
        ),
      )
      expect(partial.settings).toEqual({
        synced: { ...SYNCED_DEFAULTS, volume: 1 },
        device: { ...DEVICE_DEFAULTS, font: 'inter' },
      })
    })

    it('reads a missing or invalid export time as 0', () => {
      for (const exportedAt of [undefined, null, '2026-10-17', true]) {
        expect(ok(parseExport(fileWith({ exportedAt }))).exportedAt).toBe(0)
      }
    })
  })

  it('lists every failure reason once', () => {
    expectTypeOf<(typeof EXPORT_ERROR_REASONS)[number]>().toEqualTypeOf<ExportErrorReason>()
    expect(new Set(EXPORT_ERROR_REASONS).size).toBe(EXPORT_ERROR_REASONS.length)
    expect(Object.isFrozen(EXPORT_ERROR_REASONS)).toBe(true)
  })
})

describe('export round trips', () => {
  const time = fc.integer({ min: 0, max: 4_102_444_800_000 })
  const span = fc.oneof(
    fc.integer({ min: 0, max: 100 * 3600 * SECOND }),
    fc.integer({ min: 0, max: 4000 }).map((n) => n / 8),
  )
  const timerState = fc.oneof(
    fc.record({ phase: fc.constant('idle' as const), duration: span }),
    fc.record({ phase: fc.constant('running' as const), duration: span, endsAt: time }),
    fc.record({ phase: fc.constant('paused' as const), duration: span, remaining: span }),
    fc.record({ phase: fc.constant('ringing' as const), duration: span, endedAt: time }),
  )
  const laps = fc.array(span, { maxLength: 20 })
  const stopwatchState = fc.oneof(
    fc.record({ phase: fc.constant('idle' as const) }),
    fc.record({
      phase: fc.constant('running' as const),
      startedAt: time,
      accumulated: span,
      laps,
    }),
    fc.record({ phase: fc.constant('paused' as const), accumulated: span, laps }),
  )
  const name = fc
    .string({ unit: 'grapheme', minLength: 1, maxLength: 24 })
    .map((s) => s.trim())
    .filter((s) => s !== '')
  const base = {
    id: fc.string({ minLength: 1, maxLength: 40 }),
    name,
    createdAt: time,
    muted: fc.boolean(),
    icon: fc.constantFrom('🍵', '🇹🇼', '1️⃣', '👩‍💻', '👋🏽'),
  }
  const common = ['id', 'name', 'createdAt', 'muted', 'kind'] as const
  const card: fc.Arbitrary<Card> = fc.oneof(
    fc.record(
      { ...base, kind: fc.constant('timer' as const), timer: timerState },
      { requiredKeys: [...common, 'timer'] },
    ),
    fc.record(
      { ...base, kind: fc.constant('stopwatch' as const), stopwatch: stopwatchState },
      { requiredKeys: [...common, 'stopwatch'] },
    ),
  )
  const preset: fc.Arbitrary<ExportPreset> = fc.record({
    id: fc.string({ minLength: 1, maxLength: 40 }),
    name,
    duration: fc.integer({ min: 1, max: 100 * 3600 * SECOND }),
  })
  const chip = fc.integer({ min: 1, max: 86_400 }).map((s) => s * SECOND)
  const synced: fc.Arbitrary<SyncedSettings> = fc.record({
    timeStyle: fc.constantFrom(...TIME_STYLES),
    hourCycle: fc.constantFrom(...HOUR_CYCLES),
    quickAdd: fc.tuple(chip, chip, chip),
    sound: fc.constantFrom(...SOUND_IDS),
    volume: fc.integer({ min: 0, max: 20 }).map((n) => n / 20),
    loop: fc.boolean(),
    autoStopMinutes: fc.integer({ min: 0, max: 60 }),
    showOvertime: fc.boolean(),
    notifications: fc.boolean(),
    confirmDelete: fc.boolean(),
    keymap: fc.constantFrom({}, { reset: ['x'] }, { help: [], palette: ['Mod+P', 'F1'] }),
  })
  const device: fc.Arbitrary<DeviceSettings> = fc.record({
    themeMode: fc.constantFrom(...THEME_MODES),
    seed: fc.constantFrom('', '#0b57d0', '#8e24aa'),
    font: fc.constantFrom(...FONT_IDS),
    fontWeight: fc.integer({ min: 3, max: 7 }).map((n) => n * 100),
    digitScale: fc.constantFrom(0.75, 1, 1.25, 1.5),
    ringScale: fc.constantFrom(0.5, 1, 1.7, 2),
    density: fc.constantFrom(...DENSITIES),
    locale: fc.constantFrom(...LOCALES, 'auto' as const),
  })
  const content: fc.Arbitrary<ExportContent> = fc.record({
    exportedAt: time,
    cards: fc.uniqueArray(card, { selector: (c) => c.id, maxLength: 8 }),
    presets: fc.uniqueArray(preset, { selector: (p) => p.id, maxLength: 6 }),
    settings: fc.record({ synced, device }),
  })

  it('reads every exported state back exactly, for every timer and stopwatch phase', () => {
    fc.assert(
      fc.property(content, (c) => {
        const data = createExport(c)
        expect(ok(parseExport(stringifyExport(data)))).toEqual(data)
      }),
      { numRuns: 300 },
    )
  })

  it('never throws on arbitrary text or JSON', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.json(),
          fc
            .jsonValue()
            .map((value) => JSON.stringify({ app: 'timer-app', format: 1, cards: value })),
        ),
        (text) => {
          const result = parseExport(text)
          expect(typeof result.ok).toBe('boolean')
        },
      ),
      { numRuns: 500 },
    )
  })
})
