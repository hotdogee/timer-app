import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { cards, keymap, settings, type StopwatchState, type TimerState } from '../core'
import type { Preset } from '../state/presets'
import {
  AUTH_VALUE_IDS,
  DESKTOP_VALUE_IDS,
  DEVICE_VALUES_SCHEMA,
  SYNCED_TABLES_SCHEMA,
  SYNCED_VALUES_SCHEMA,
  cardToRow,
  cardsFromTable,
  changedValues,
  desktopSettingsToValues,
  deviceAuthToValues,
  deviceSettingsToValues,
  presetToRow,
  presetsFromTable,
  rowToCard,
  rowToPreset,
  sameCard,
  syncedSettingsToValues,
  valuesToDesktopSettings,
  valuesToDeviceAuth,
  valuesToDeviceSettings,
  valuesToSyncedSettings,
  type CardRow,
} from './schema'

const MINUTE = 60_000
/** 14:47 UTC on 2026-10-17. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

/** Spans as the engine stores them: 0 to 8.64e15, never -0. */
const span = fc
  .oneof(
    fc.constant(0),
    fc.integer({ min: 0, max: 2 ** 31 - 1 }),
    fc.double({ min: 0, max: 8.64e15, noNaN: true }),
  )
  .map((n) => (n === 0 ? 0 : n))
/** Clock readings: any finite number. */
const time = fc.double({ noNaN: true, noDefaultInfinity: true }).map((n) => (n === 0 ? 0 : n))
/** Names as the card model keeps them: trimmed and not empty, any script. */
const name = fc
  .oneof(fc.string({ unit: 'grapheme', minLength: 1 }), fc.string({ unit: 'binary', minLength: 1 }))
  .map((s) => s.trim())
  .filter((s) => s !== '')
const id = fc.string({ minLength: 1, maxLength: 40 })

const timerState: fc.Arbitrary<TimerState> = fc.oneof(
  fc.record({ phase: fc.constant('idle' as const), duration: span }),
  fc.record({ phase: fc.constant('running' as const), duration: span, endsAt: time }),
  fc.record({ phase: fc.constant('paused' as const), duration: span, remaining: span }),
  fc.record({ phase: fc.constant('ringing' as const), duration: span, endedAt: time }),
)
const laps = fc.array(span, { maxLength: 12 })
const stopwatchState: fc.Arbitrary<StopwatchState> = fc.oneof(
  fc.record({ phase: fc.constant('idle' as const) }),
  fc.record({
    phase: fc.constant('running' as const),
    startedAt: time,
    accumulated: span,
    laps,
  }),
  fc.record({ phase: fc.constant('paused' as const), accumulated: span, laps }),
)
/** Card icons: emoji of every shape (absent from about half the cards). */
const icon = fc.constantFrom('🍵', '🇹🇼', '1️⃣', '👩‍💻', '👋🏽', '🏴󠁧󠁢󠁥󠁮󠁧󠁿')
const cardFields = { id, name, createdAt: time, muted: fc.boolean(), icon }
const common = ['id', 'name', 'createdAt', 'muted', 'kind'] as const
const card: fc.Arbitrary<cards.Card> = fc.oneof(
  fc.record(
    { ...cardFields, kind: fc.constant('timer' as const), timer: timerState },
    { requiredKeys: [...common, 'timer'] },
  ),
  fc.record(
    { ...cardFields, kind: fc.constant('stopwatch' as const), stopwatch: stopwatchState },
    { requiredKeys: [...common, 'stopwatch'] },
  ),
)

const timerCard = (t: TimerState, extra: Partial<cards.TimerCard> = {}): cards.TimerCard => ({
  ...cards.createTimerCard('a', 'Tea', NOW),
  timer: t,
  ...extra,
})
const stopwatchCard = (s: StopwatchState): cards.StopwatchCard => ({
  ...cards.createStopwatchCard('b', 'Laps', NOW),
  stopwatch: s,
})

describe('the store schemas', () => {
  it('have a synced value for every synced setting, plus the bookkeeping', () => {
    expect(Object.keys(SYNCED_VALUES_SCHEMA).sort()).toEqual(
      [...Object.keys(settings.SYNCED_DEFAULTS), 'schemaVersion', 'seededAt'].sort(),
    )
  })

  it('have a value for every device and desktop setting and the token, plus the version', () => {
    expect(Object.keys(DEVICE_VALUES_SCHEMA).sort()).toEqual(
      [
        ...Object.keys(settings.DEVICE_DEFAULTS),
        ...DESKTOP_VALUE_IDS,
        ...AUTH_VALUE_IDS,
        'schemaVersion',
      ].sort(),
    )
    expect(Object.keys(desktopSettingsToValues(settings.DESKTOP_DEFAULTS)).sort()).toEqual(
      [...DESKTOP_VALUE_IDS].sort(),
    )
  })

  it('give no cell or value a default, so a fresh store never outvotes saved data in a merge', () => {
    const schemas = [
      ...Object.values(SYNCED_TABLES_SCHEMA).flatMap((table) => Object.values(table)),
      ...Object.values(SYNCED_VALUES_SCHEMA),
      ...Object.values(DEVICE_VALUES_SCHEMA),
    ]
    for (const schema of schemas) expect(schema).not.toHaveProperty('default')
  })
})

describe('cardToRow', () => {
  it('writes an idle timer with its duration and the common cells', () => {
    expect(cardToRow(cards.createTimerCard('a', 'Tea', NOW, 3 * MINUTE), 2)).toEqual({
      kind: 'timer',
      name: 'Tea',
      createdAt: NOW,
      muted: false,
      position: 2,
      phase: 'idle',
      duration: 3 * MINUTE,
    })
  })

  it('writes only the cells of the timer phase', () => {
    const at = { duration: MINUTE }
    expect(cardToRow(timerCard({ phase: 'running', ...at, endsAt: NOW }), 0)).toMatchObject({
      phase: 'running',
      duration: MINUTE,
      endsAt: NOW,
    })
    const paused = cardToRow(timerCard({ phase: 'paused', ...at, remaining: 5 }), 0)
    expect(paused).toMatchObject({ phase: 'paused', remaining: 5 })
    expect(paused).not.toHaveProperty('endsAt')
    const ringing = cardToRow(timerCard({ phase: 'ringing', ...at, endedAt: NOW }), 0)
    expect(Object.keys(ringing).sort()).toEqual(
      ['kind', 'name', 'createdAt', 'muted', 'position', 'phase', 'duration', 'endedAt'].sort(),
    )
  })

  it('writes a stopwatch with its phase cells and the laps as JSON', () => {
    expect(cardToRow(stopwatchCard({ phase: 'idle' }), 1)).toEqual({
      kind: 'stopwatch',
      name: 'Laps',
      createdAt: NOW,
      muted: false,
      position: 1,
      phase: 'idle',
    })
    const running = { phase: 'running', startedAt: NOW, accumulated: 1500, laps: [500, 1200.5] }
    expect(cardToRow(stopwatchCard(running as StopwatchState), 0)).toMatchObject({
      phase: 'running',
      startedAt: NOW,
      accumulated: 1500,
      laps: '[500,1200.5]',
    })
    const paused = cardToRow(stopwatchCard({ phase: 'paused', accumulated: 9, laps: [] }), 0)
    expect(paused).toMatchObject({ phase: 'paused', accumulated: 9, laps: '[]' })
    expect(paused).not.toHaveProperty('startedAt')
  })

  it('keeps the mute flag', () => {
    expect(cardToRow({ ...cards.createTimerCard('a', 'T', 0), muted: true }, 0).muted).toBe(true)
  })

  it('writes the icon cell only for a card with an icon', () => {
    const plain = cards.createTimerCard('a', 'Tea', NOW)
    expect(cardToRow({ ...plain, icon: '🍵' }, 0)).toMatchObject({ icon: '🍵' })
    expect(cardToRow(plain, 0)).not.toHaveProperty('icon')
  })
})

describe('rowToCard', () => {
  const timerRow: CardRow = { kind: 'timer', name: 'Tea', createdAt: NOW, muted: true }

  it('reads back every card it wrote, in every phase (property)', () => {
    fc.assert(
      fc.property(card, fc.nat(), (c, position) => {
        expect(rowToCard(c.id, cardToRow(c, position))).toEqual(c)
      }),
      { numRuns: 500 },
    )
  })

  it('reads the icon back, and a card without the cell has none', () => {
    const row = cardToRow({ ...cards.createStopwatchCard('b', 'Run', NOW), icon: '🏃' }, 0)
    expect(rowToCard('b', row)).toMatchObject({ icon: '🏃' })
    const withoutIcon = { ...row }
    delete withoutIcon.icon
    expect(rowToCard('b', withoutIcon)).toEqual(cards.createStopwatchCard('b', 'Run', NOW))
  })

  it('reads an icon cell that is not an emoji as no icon', () => {
    for (const cell of ['', '  ', 'tea', '🏻', '\u200D', '🍵'.repeat(20)]) {
      const read = rowToCard('a', { ...timerRow, icon: cell })
      expect(read).not.toHaveProperty('icon')
    }
    // A cell of another type (an older or newer app's) reads as none too.
    const odd = { ...timerRow, icon: 7 } as unknown as CardRow
    expect(rowToCard('a', odd)).not.toHaveProperty('icon')
  })

  it('is not a card without an id or a known kind', () => {
    expect(rowToCard('', cardToRow(cards.createTimerCard('a', 'T', 0), 0))).toBeNull()
    expect(rowToCard('a', { name: 'Renamed' })).toBeNull()
    expect(rowToCard('a', { kind: 'alarm', name: 'Clock' })).toBeNull()
  })

  it('falls back to the default name, time 0 and unmuted, cell by cell', () => {
    expect(rowToCard('a', { kind: 'timer' })).toEqual({
      ...cards.createTimerCard('a', 'Timer', 0),
    })
    expect(rowToCard('b', { kind: 'stopwatch', name: '   ', createdAt: NaN })).toEqual(
      cards.createStopwatchCard('b', 'Stopwatch', 0),
    )
    expect(rowToCard('a', { ...timerRow, name: '  Tea  ' })?.name).toBe('Tea')
  })

  it('reads a timer without a usable duration as 5:00', () => {
    for (const duration of [undefined, -1, Infinity, 9e15]) {
      const row = duration === undefined ? timerRow : { ...timerRow, duration }
      expect(rowToCard('a', { ...row, phase: 'idle' })).toMatchObject({
        timer: { phase: 'idle', duration: 5 * MINUTE },
      })
    }
  })

  it('reads a timer phase whose own cell is missing as idle, keeping the duration', () => {
    const at = { ...timerRow, duration: MINUTE }
    const idle = { timer: { phase: 'idle', duration: MINUTE } }
    expect(rowToCard('a', { ...at, phase: 'running' })).toMatchObject(idle)
    expect(rowToCard('a', { ...at, phase: 'paused', remaining: -5 })).toMatchObject(idle)
    expect(rowToCard('a', { ...at, phase: 'ringing' })).toMatchObject(idle)
    expect(rowToCard('a', { ...at, phase: 'snoozing' })).toMatchObject(idle)
    expect(rowToCard('a', at)).toMatchObject(idle)
  })

  it('ignores cells of another phase that a merge left behind', () => {
    const row = { ...timerRow, phase: 'paused', duration: MINUTE, remaining: 10, endsAt: NOW }
    expect(rowToCard('a', row)).toMatchObject({
      timer: { phase: 'paused', duration: MINUTE, remaining: 10 },
    })
    expect(rowToCard('a', row)).not.toHaveProperty('timer.endsAt')
  })

  it('reads a stopwatch phase whose cells are missing as idle', () => {
    const sw: CardRow = { kind: 'stopwatch', name: 'Laps', createdAt: NOW }
    expect(rowToCard('b', { ...sw, phase: 'running', accumulated: 5 })).toMatchObject({
      stopwatch: { phase: 'idle' },
    })
    expect(rowToCard('b', { ...sw, phase: 'paused' })).toMatchObject({
      stopwatch: { phase: 'idle' },
    })
    expect(rowToCard('b', { ...sw, phase: 'gone', accumulated: 5 })).toMatchObject({
      stopwatch: { phase: 'idle' },
    })
  })

  it('reads unusable laps as none and keeps the stopwatch running', () => {
    const sw: CardRow = { kind: 'stopwatch', phase: 'running', startedAt: NOW, accumulated: 7 }
    for (const lapsCell of [undefined, 'not json', '{"a":1}', '[1,-2]', '[1,"2"]', '[1e300]']) {
      const row = lapsCell === undefined ? sw : { ...sw, laps: lapsCell }
      expect(rowToCard('b', row)).toMatchObject({
        stopwatch: { phase: 'running', startedAt: NOW, accumulated: 7, laps: [] },
      })
    }
    expect(rowToCard('b', { ...sw, laps: '[1,2.5]' })).toMatchObject({
      stopwatch: { laps: [1, 2.5] },
    })
  })
})

describe('sameCard', () => {
  it('compares the stored cells, not object identity', () => {
    const a = cards.createTimerCard('a', 'Tea', NOW)
    expect(sameCard(a, { ...a })).toBe(true)
    expect(sameCard(a, { ...a, name: 'Coffee' })).toBe(false)
    expect(sameCard(a, { ...a, id: 'b' })).toBe(false)
    expect(sameCard(a, { ...a, icon: '🍵' })).toBe(false)
    expect(sameCard({ ...a, icon: '🍵' }, { ...a, icon: '🍵' })).toBe(true)
    expect(sameCard({ ...a, icon: '🍵' }, { ...a, icon: '☕' })).toBe(false)
    expect(
      sameCard(a, { ...a, timer: { phase: 'running', duration: a.timer.duration, endsAt: 1 } }),
    ).toBe(false)
  })

  it('holds for every card and its decoded copy (property)', () => {
    fc.assert(
      fc.property(card, (c) => {
        const back = rowToCard(c.id, cardToRow(c, 0))
        expect(back !== null && sameCard(c, back)).toBe(true)
      }),
    )
  })
})

describe('cardsFromTable', () => {
  const at = (id: string, position: number | undefined, createdAt = NOW): CardRow => ({
    ...cardToRow(cards.createTimerCard(id, id, createdAt), 0),
    ...(position === undefined ? {} : { position }),
  })
  const order = (table: Record<string, CardRow>): string[] =>
    cardsFromTable(table).map(({ item }) => item.id)

  it('sorts by position, then createdAt, then id, rows without a position last', () => {
    const table: Record<string, CardRow> = {
      d: at('d', undefined, 0),
      c: at('c', 1, NOW + 1),
      b: at('b', 1, NOW),
      a2: at('a2', 0),
      a1: at('a1', 0),
    }
    if (table.d) delete table.d.position
    expect(order(table)).toEqual(['a1', 'a2', 'b', 'c', 'd'])
  })

  it('reports the stored positions, NaN for a row without one', () => {
    const table: Record<string, CardRow> = { a: at('a', 4), b: at('b', 9) }
    if (table.b) delete table.b.position
    expect(cardsFromTable(table).map(({ position }) => position)).toEqual([4, NaN])
  })

  it('skips rows that are not cards', () => {
    expect(order({ a: at('a', 0), ghost: { name: 'Renamed', position: 0 } })).toEqual(['a'])
  })

  it('reads back any list written at its indices, in order (property)', () => {
    const list = fc.uniqueArray(card, { selector: (c) => c.id, maxLength: 12 })
    fc.assert(
      fc.property(list, (written) => {
        const table = Object.fromEntries(written.map((c, i) => [c.id, cardToRow(c, i)]))
        const read = cardsFromTable(table)
        expect(read.map(({ item }) => item)).toEqual(written)
        expect(read.map(({ position }) => position)).toEqual(written.map((_, i) => i))
      }),
    )
  })
})

describe('presets', () => {
  const preset = fc.record({
    id,
    name,
    duration: fc.integer({ min: 1, max: 2 ** 31 - 1 }),
  })

  it('round-trip through their rows (property)', () => {
    fc.assert(
      fc.property(preset, fc.nat(), (p, position) => {
        const row = presetToRow(p, position)
        expect(row.position).toBe(position)
        expect(rowToPreset(p.id, row)).toEqual(p)
      }),
    )
  })

  it('are not usable without an id, a name or a positive duration', () => {
    const ok = { name: 'Tea', duration: 3 * MINUTE }
    expect(rowToPreset('tea', ok)).toEqual({ id: 'tea', ...ok })
    expect(rowToPreset('tea', { ...ok, name: '  Tea ' })?.name).toBe('Tea')
    expect(rowToPreset('', ok)).toBeNull()
    expect(rowToPreset('tea', { duration: MINUTE })).toBeNull()
    expect(rowToPreset('tea', { ...ok, name: ' ' })).toBeNull()
    for (const duration of [0, -1, NaN, Infinity, 9e15]) {
      expect(rowToPreset('tea', { ...ok, duration })).toBeNull()
    }
    expect(rowToPreset('tea', { name: 'Tea' })).toBeNull()
  })

  it('come out of their table by position, then id', () => {
    const rows = {
      c: { name: 'C', duration: 1, position: 1 },
      b: { name: 'B', duration: 1, position: 1 },
      a: { name: 'A', duration: 1, position: 0 },
      z: { name: 'Z', duration: 1 },
      bad: { name: '', duration: 1, position: 0 },
    }
    expect(presetsFromTable(rows).map(({ item }) => item.id)).toEqual(['a', 'b', 'c', 'z'])
  })

  it('read the built-in seed back as written', () => {
    const builtins: Preset[] = [{ id: 'tea', name: 'Tea', duration: 3 * MINUTE }]
    const table = Object.fromEntries(builtins.map((p, i) => [p.id, presetToRow(p, i)]))
    expect(presetsFromTable(table).map(({ item }) => item)).toEqual(builtins)
  })
})

describe('changedValues', () => {
  it('lists the values that differ, or null when none does', () => {
    expect(changedValues({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBeNull()
    expect(changedValues({ a: 1, b: 'x' }, { a: 2, b: 'x' })).toEqual({ a: 2 })
    expect(changedValues({ a: 0 }, { a: -0 })).toEqual({ a: -0 })
    expect(changedValues({ a: NaN }, { a: NaN })).toBeNull()
  })
})

describe('synced settings values', () => {
  const anySynced = fc
    .record({
      timeStyle: fc.constantFrom(...settings.TIME_STYLES),
      hourCycle: fc.constantFrom(...settings.HOUR_CYCLES),
      quickAdd: fc.tuple(fc.nat(), fc.nat(), fc.nat()),
      sound: fc.constantFrom(...settings.SOUND_IDS),
      volume: fc.double({ min: 0, max: 1, noNaN: true }),
      loop: fc.boolean(),
      autoStopMinutes: fc.nat({ max: 60 }),
      showOvertime: fc.boolean(),
      notifications: fc.boolean(),
      confirmDelete: fc.boolean(),
      keymap: fc.dictionary(fc.constantFrom(...keymap.ACTION_IDS), fc.constant(['Shift+T'])),
    })
    .map((input) => settings.migrateSyncedSettings(input))

  it('are the defaults when nothing is stored', () => {
    expect(valuesToSyncedSettings({})).toEqual(settings.SYNCED_DEFAULTS)
  })

  it('flatten quickAdd and the keymap to JSON', () => {
    const values = syncedSettingsToValues({
      ...settings.SYNCED_DEFAULTS,
      keymap: { newTimer: ['Shift+T'] },
    })
    expect(values.quickAdd).toBe('[30000,60000,300000]')
    expect(values.keymap).toBe('{"newTimer":["Shift+T"]}')
    expect(values).not.toHaveProperty('schemaVersion')
  })

  it('round-trip every valid settings object (property)', () => {
    fc.assert(
      fc.property(anySynced, (s) => {
        expect(valuesToSyncedSettings(syncedSettingsToValues(s))).toEqual(s)
      }),
    )
  })

  it('read invalid values as their defaults and clamp numbers', () => {
    const s = valuesToSyncedSettings({
      timeStyle: 'roman',
      quickAdd: 'not json',
      keymap: '[1, 2]',
      volume: 7,
      autoStopMinutes: 2.6,
      schemaVersion: 1,
    })
    expect(s.timeStyle).toBe('compact')
    expect(s.quickAdd).toEqual(settings.SYNCED_DEFAULTS.quickAdd)
    expect(s.keymap).toEqual({})
    expect(s.volume).toBe(1)
    expect(s.autoStopMinutes).toBe(3)
  })

  it('read data from a newer or unknown schema version leniently', () => {
    expect(valuesToSyncedSettings({ schemaVersion: 99, loop: false }).loop).toBe(false)
    expect(valuesToSyncedSettings({ schemaVersion: -1, loop: false }).loop).toBe(false)
  })

  it('give back the previous object when nothing changed', () => {
    const values = syncedSettingsToValues({ ...settings.SYNCED_DEFAULTS, loop: false })
    const first = valuesToSyncedSettings(values)
    expect(valuesToSyncedSettings(values, first)).toBe(first)
  })

  it('keep the previous keymap and quickAdd objects while their content is the same', () => {
    const values = syncedSettingsToValues({
      ...settings.SYNCED_DEFAULTS,
      keymap: { newTimer: ['Shift+T'] },
    })
    const first = valuesToSyncedSettings(values)
    const next = valuesToSyncedSettings({ ...values, volume: 0.25 }, first)
    expect(next).not.toBe(first)
    expect(next.volume).toBe(0.25)
    expect(next.keymap).toBe(first.keymap)
    expect(next.quickAdd).toBe(first.quickAdd)
    expect(settings.bindingsWith(next.keymap)).toBe(settings.bindingsWith(first.keymap))
    expect(Object.isFrozen(next)).toBe(true)
    const changed = valuesToSyncedSettings({ ...values, keymap: '{}' }, first)
    expect(changed.keymap).toEqual({})
    expect(changed.quickAdd).toBe(first.quickAdd)
  })
})

describe('device settings values', () => {
  it('are the defaults when nothing is stored', () => {
    expect(valuesToDeviceSettings({})).toEqual(settings.DEVICE_DEFAULTS)
  })

  it('round-trip valid settings', () => {
    const device: settings.DeviceSettings = {
      themeMode: 'dark',
      seed: '#8e24aa',
      font: 'inter',
      fontWeight: 600,
      digitScale: 1.25,
      ringScale: 2,
      density: 'compact',
      locale: 'zh-TW',
    }
    expect(valuesToDeviceSettings(deviceSettingsToValues(device))).toEqual(device)
  })

  it('read invalid values as their defaults and drop the schema version', () => {
    const d = valuesToDeviceSettings({ schemaVersion: 1, themeMode: 'sepia', fontWeight: 1000 })
    expect(d).toEqual({ ...settings.DEVICE_DEFAULTS, fontWeight: 700 })
    expect(d).not.toHaveProperty('schemaVersion')
  })

  it('give back the previous object when nothing changed', () => {
    const first = valuesToDeviceSettings({ locale: 'ja' })
    expect(valuesToDeviceSettings({ locale: 'ja' }, first)).toBe(first)
    expect(valuesToDeviceSettings({ locale: 'en' }, first).locale).toBe('en')
  })
})

describe('desktop settings values', () => {
  const desktop: settings.DesktopSettings = {
    launchAtLogin: true,
    closeBehavior: 'quit',
    miniAlwaysOnTop: false,
    hotkeys: { toggleLast: 'Mod+Shift+Space', showApp: null },
  }

  it('are the defaults when nothing is stored, as before the desktop group existed', () => {
    expect(valuesToDesktopSettings({})).toEqual(settings.DESKTOP_DEFAULTS)
    expect(valuesToDesktopSettings({ schemaVersion: 1, themeMode: 'dark' })).toEqual(
      settings.DESKTOP_DEFAULTS,
    )
  })

  it('store an unbound hotkey as an empty combo, and round-trip', () => {
    expect(desktopSettingsToValues(desktop)).toEqual({
      launchAtLogin: true,
      closeBehavior: 'quit',
      miniAlwaysOnTop: false,
      hotkeyToggleLast: 'Mod+Shift+Space',
      hotkeyShowApp: '',
    })
    expect(valuesToDesktopSettings(desktopSettingsToValues(desktop))).toEqual(desktop)
  })

  it('read invalid values as their defaults', () => {
    expect(
      valuesToDesktopSettings({ closeBehavior: 'hide', hotkeyToggleLast: 'Mod+', authToken: 'x' }),
    ).toEqual(settings.DESKTOP_DEFAULTS)
  })

  it('leave the device settings alone, and the device settings leave them alone', () => {
    const values = { ...deviceSettingsToValues(settings.DEVICE_DEFAULTS), locale: 'ja' }
    expect(valuesToDesktopSettings({ ...values, ...desktopSettingsToValues(desktop) })).toEqual(
      desktop,
    )
    expect(valuesToDeviceSettings({ ...values, ...desktopSettingsToValues(desktop) })).toEqual({
      ...settings.DEVICE_DEFAULTS,
      locale: 'ja',
    })
  })

  it('give back the previous object when nothing changed, and its hotkeys while they stay', () => {
    const first = valuesToDesktopSettings(desktopSettingsToValues(desktop))
    expect(valuesToDesktopSettings(desktopSettingsToValues(desktop), first)).toBe(first)
    const changed = valuesToDesktopSettings(
      { ...desktopSettingsToValues(desktop), closeBehavior: 'tray' },
      first,
    )
    expect(changed).not.toBe(first)
    expect(changed.closeBehavior).toBe('tray')
    expect(changed.hotkeys).toBe(first.hotkeys)
    const rebound = valuesToDesktopSettings(
      { ...desktopSettingsToValues(desktop), hotkeyShowApp: 'Mod+Shift+T' },
      first,
    )
    expect(rebound.hotkeys).toEqual({ toggleLast: 'Mod+Shift+Space', showApp: 'Mod+Shift+T' })
  })
})

describe('bearer token values', () => {
  const auth: settings.DeviceAuth = { token: 'tok.en+/=', expiresAt: NOW + 30 * 24 * 60 * MINUTE }

  it('are no token when nothing (or only half of one) is stored', () => {
    expect(valuesToDeviceAuth({})).toBeNull()
    expect(valuesToDeviceAuth({ authToken: 'abc' })).toBeNull()
    expect(valuesToDeviceAuth({ authExpiresAt: NOW })).toBeNull()
  })

  it('round-trip a token', () => {
    expect(deviceAuthToValues(auth)).toEqual({
      authToken: 'tok.en+/=',
      authExpiresAt: auth.expiresAt,
    })
    expect(valuesToDeviceAuth(deviceAuthToValues(auth))).toEqual(auth)
  })

  it('read an unusable token as none', () => {
    expect(valuesToDeviceAuth({ authToken: 'two words', authExpiresAt: NOW })).toBeNull()
    expect(valuesToDeviceAuth({ authToken: 'abc', authExpiresAt: -5 })).toBeNull()
  })

  it('give back the previous token when it is the same', () => {
    const first = valuesToDeviceAuth(deviceAuthToValues(auth))
    expect(valuesToDeviceAuth(deviceAuthToValues(auth), first)).toBe(first)
    expect(valuesToDeviceAuth(deviceAuthToValues({ ...auth, token: 'other' }), first)).toEqual({
      ...auth,
      token: 'other',
    })
    expect(valuesToDeviceAuth({}, first)).toBeNull()
  })
})
