import fc from 'fast-check'
import { describe, expect, expectTypeOf, it } from 'vitest'

import type { SoundId as PlatformSoundId } from '../platform/sound-patterns'
import { ACTION_IDS, DEFAULT_BINDINGS, resolveAction, type KeyEventLike } from './keymap'
import {
  bindingsWith,
  DENSITIES,
  DEVICE_DEFAULTS,
  FONT_IDS,
  HOUR_CYCLES,
  isLocale,
  LOCALES,
  migrateDeviceSettings,
  migrateSyncedSettings,
  runMigrations,
  SETTING_RANGES,
  SETTINGS_SCHEMA_VERSION,
  SOUND_IDS,
  SYNCED_DEFAULTS,
  THEME_MODES,
  TIME_STYLES,
  type DeviceSettings,
  type KeymapOverrides,
  type SyncedSettings,
  type TimeStyle,
} from './settings'
import type { TimeStyle as FormatTimeStyle } from './types'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** Values of every JSON type and a few JavaScript-only ones, none of them valid for any setting. */
const JUNK: readonly unknown[] = [undefined, null, NaN, Infinity, -Infinity, {}, [], () => 1, 'x']

/** Device settings from `fields` merged over nothing (the rest falls back to defaults). */
function device(fields: Record<string, unknown>): DeviceSettings {
  return migrateDeviceSettings(fields)
}

function synced(fields: Record<string, unknown>): SyncedSettings {
  return migrateSyncedSettings(fields)
}

function ev(key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

describe('types', () => {
  it('shares the sound ids with the platform audio and the time style with format', () => {
    expectTypeOf<(typeof SOUND_IDS)[number]>().toEqualTypeOf<PlatformSoundId>()
    expectTypeOf<TimeStyle>().toEqualTypeOf<FormatTimeStyle>()
  })
})

describe('choices', () => {
  it('lists every choice once, frozen', () => {
    const lists = [THEME_MODES, FONT_IDS, DENSITIES, HOUR_CYCLES, TIME_STYLES, SOUND_IDS, LOCALES]
    for (const list of lists) {
      expect(Object.isFrozen(list)).toBe(true)
      expect(new Set(list).size).toBe(list.length)
    }
    expect(LOCALES).toEqual(['en', 'zh-TW', 'ja'])
    expect(SOUND_IDS).toEqual(['chime', 'bell', 'beep'])
  })

  it('recognizes the shipped locales only', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true)
    for (const other of ['auto', 'zh-tw', 'zh', 'en-US', 'fr', '', ...JUNK]) {
      expect(isLocale(other)).toBe(false)
    }
  })
})

describe('defaults', () => {
  it('match the spec', () => {
    expect(DEVICE_DEFAULTS).toEqual({
      themeMode: 'system',
      seed: '',
      font: 'roboto-flex',
      fontWeight: 400,
      digitScale: 1,
      ringScale: 1,
      density: 'comfortable',
      locale: 'auto',
    })
    expect(SYNCED_DEFAULTS).toEqual({
      timeStyle: 'compact',
      hourCycle: 'auto',
      quickAdd: [30 * SECOND, MINUTE, 5 * MINUTE],
      sound: 'chime',
      volume: 0.8,
      loop: true,
      autoStopMinutes: 0,
      showOvertime: true,
      notifications: true,
      confirmDelete: false,
      keymap: {},
    })
    expect(SETTINGS_SCHEMA_VERSION).toBe(1)
  })

  it('are frozen, nested values too', () => {
    expect(Object.isFrozen(DEVICE_DEFAULTS)).toBe(true)
    expect(Object.isFrozen(SYNCED_DEFAULTS)).toBe(true)
    expect(Object.isFrozen(SYNCED_DEFAULTS.quickAdd)).toBe(true)
    expect(Object.isFrozen(SYNCED_DEFAULTS.keymap)).toBe(true)
    expect(Object.isFrozen(SETTING_RANGES)).toBe(true)
    for (const range of Object.values(SETTING_RANGES)) expect(Object.isFrozen(range)).toBe(true)
  })

  it('lie inside their ranges, on a step where the setting is stepped', () => {
    const r = SETTING_RANGES
    const inside = (value: number, range: { min: number; max: number }) =>
      value >= range.min && value <= range.max
    expect(inside(DEVICE_DEFAULTS.fontWeight, r.fontWeight)).toBe(true)
    expect(DEVICE_DEFAULTS.fontWeight % r.fontWeight.step).toBe(0)
    expect(inside(DEVICE_DEFAULTS.digitScale, r.digitScale)).toBe(true)
    expect(inside(DEVICE_DEFAULTS.ringScale, r.ringScale)).toBe(true)
    expect(inside(SYNCED_DEFAULTS.volume, r.volume)).toBe(true)
    expect(inside(SYNCED_DEFAULTS.autoStopMinutes, r.autoStopMinutes)).toBe(true)
    for (const ms of SYNCED_DEFAULTS.quickAdd) {
      expect(inside(ms, r.quickAdd)).toBe(true)
      expect(ms % r.quickAdd.step).toBe(0)
    }
    expect(r.quickAdd).toEqual({ min: SECOND, max: 24 * HOUR, step: SECOND })
  })

  it('survive validation unchanged', () => {
    expect(migrateDeviceSettings(DEVICE_DEFAULTS)).toEqual(DEVICE_DEFAULTS)
    expect(migrateSyncedSettings(SYNCED_DEFAULTS)).toEqual(SYNCED_DEFAULTS)
  })
})

describe('migrateDeviceSettings', () => {
  it('gives the defaults for no data, an empty object and any non-object', () => {
    expect(migrateDeviceSettings(undefined)).toEqual(DEVICE_DEFAULTS)
    expect(migrateDeviceSettings({})).toEqual(DEVICE_DEFAULTS)
    for (const junk of [null, 42, 'dark', true, [], () => ({ themeMode: 'dark' })]) {
      expect(migrateDeviceSettings(junk)).toEqual(DEVICE_DEFAULTS)
    }
  })

  it('keeps a complete valid object as it is, in a new frozen object', () => {
    const input: DeviceSettings = {
      themeMode: 'dark',
      seed: '#8e24aa',
      font: 'inter',
      fontWeight: 600,
      digitScale: 1.25,
      ringScale: 1.5,
      density: 'compact',
      locale: 'zh-TW',
    }
    const out = migrateDeviceSettings(input)
    expect(out).toEqual(input)
    expect(out).not.toBe(input)
    expect(Object.isFrozen(out)).toBe(true)
  })

  it('drops unknown fields, including ones named like Object.prototype members', () => {
    const input = JSON.parse(
      '{"themeMode":"light","extra":1,"__proto__":{"font":"inter"},"constructor":"x"}',
    ) as unknown
    const out = migrateDeviceSettings(input)
    expect(out).toEqual({ ...DEVICE_DEFAULTS, themeMode: 'light' })
    expect(Object.keys(out).sort()).toEqual(Object.keys(DEVICE_DEFAULTS).sort())
  })

  it('keeps every valid choice', () => {
    for (const themeMode of THEME_MODES) expect(device({ themeMode }).themeMode).toBe(themeMode)
    for (const font of FONT_IDS) expect(device({ font }).font).toBe(font)
    for (const density of DENSITIES) expect(device({ density }).density).toBe(density)
    for (const locale of [...LOCALES, 'auto' as const]) {
      expect(device({ locale }).locale).toBe(locale)
    }
  })

  it('falls back per field for unknown choices and wrong types, keeping the other fields', () => {
    for (const bad of ['Dark', 'auto', 'high-contrast', 1, ...JUNK]) {
      expect(device({ themeMode: bad, font: 'inter' })).toEqual({
        ...DEVICE_DEFAULTS,
        font: 'inter',
      })
    }
    for (const bad of ['Inter', 'roboto', 'comic-sans', ...JUNK]) {
      expect(device({ font: bad }).font).toBe('roboto-flex')
    }
    for (const bad of ['dense', 'Compact', ...JUNK]) {
      expect(device({ density: bad }).density).toBe('comfortable')
    }
    for (const bad of ['zh-tw', 'zh', 'zh-Hant', 'en-US', 'fr', 'AUTO', ...JUNK]) {
      expect(device({ locale: bad }).locale).toBe('auto')
    }
  })

  it('normalizes the seed to lowercase #rrggbb and keeps blank as the default seed', () => {
    const cases: [unknown, string][] = [
      ['', ''],
      ['   ', ''],
      ['#0B57D0', '#0b57d0'],
      ['#8e24aa', '#8e24aa'],
      ['0b57d0', '#0b57d0'],
      ['  #ABC ', '#aabbcc'],
      ['abc', '#aabbcc'],
      ['#12345', ''],
      ['#1234567', ''],
      ['#ggg', ''],
      ['red', ''],
      ['rgb(0, 0, 0)', ''],
      [0x0b57d0, ''],
      [null, ''],
    ]
    for (const [seed, expected] of cases) expect(device({ seed }).seed, String(seed)).toBe(expected)
  })

  it('clamps the font weight to 300–700 and rounds it to hundreds', () => {
    const cases: [number, number][] = [
      [400, 400],
      [300, 300],
      [700, 700],
      [100, 300],
      [250, 300],
      [449, 400],
      [450, 500],
      [651, 700],
      [760, 700],
      [1000, 700],
      [-400, 300],
    ]
    for (const [fontWeight, expected] of cases) {
      expect(device({ fontWeight }).fontWeight, String(fontWeight)).toBe(expected)
    }
  })

  it('clamps the digit and ring scales without rounding them', () => {
    expect(device({ digitScale: 0.5 }).digitScale).toBe(0.75)
    expect(device({ digitScale: 2 }).digitScale).toBe(1.5)
    expect(device({ digitScale: 1.234 }).digitScale).toBe(1.234)
    expect(device({ ringScale: 0 }).ringScale).toBe(0.5)
    expect(device({ ringScale: -1 }).ringScale).toBe(0.5)
    expect(device({ ringScale: 3 }).ringScale).toBe(2)
    expect(device({ ringScale: 0.73 }).ringScale).toBe(0.73)
  })

  it('falls back for numbers that are not finite numbers', () => {
    for (const bad of ['500', true, ...JUNK]) {
      expect(device({ fontWeight: bad, digitScale: bad, ringScale: bad })).toEqual(DEVICE_DEFAULTS)
    }
  })
})

describe('migrateSyncedSettings', () => {
  it('gives the defaults for no data, an empty object and any non-object', () => {
    expect(migrateSyncedSettings(undefined)).toEqual(SYNCED_DEFAULTS)
    expect(migrateSyncedSettings({})).toEqual(SYNCED_DEFAULTS)
    for (const junk of [null, 0, 'fixed', false, []]) {
      expect(migrateSyncedSettings(junk)).toEqual(SYNCED_DEFAULTS)
    }
  })

  it('keeps a complete valid object as it is, frozen through quickAdd and keymap', () => {
    const input: SyncedSettings = {
      timeStyle: 'fixed',
      hourCycle: 'h23',
      quickAdd: [10 * SECOND, 2 * MINUTE, HOUR],
      sound: 'bell',
      volume: 0.35,
      loop: false,
      autoStopMinutes: 15,
      showOvertime: false,
      notifications: false,
      confirmDelete: true,
      keymap: { reset: ['x'], lap: [] },
    }
    const out = migrateSyncedSettings(input)
    expect(out).toEqual(input)
    expect(Object.isFrozen(out)).toBe(true)
    expect(Object.isFrozen(out.quickAdd)).toBe(true)
    expect(Object.isFrozen(out.keymap)).toBe(true)
    expect(Object.isFrozen(out.keymap.reset)).toBe(true)
  })

  it('drops unknown fields', () => {
    const out = migrateSyncedSettings({ sound: 'beep', theme: 'dark', schemaVersion: 1 })
    expect(out).toEqual({ ...SYNCED_DEFAULTS, sound: 'beep' })
  })

  it('keeps every valid choice and boolean', () => {
    for (const timeStyle of TIME_STYLES) expect(synced({ timeStyle }).timeStyle).toBe(timeStyle)
    for (const hourCycle of HOUR_CYCLES) expect(synced({ hourCycle }).hourCycle).toBe(hourCycle)
    for (const sound of SOUND_IDS) expect(synced({ sound }).sound).toBe(sound)
    for (const flag of [true, false]) {
      const out = synced({
        loop: flag,
        showOvertime: flag,
        notifications: flag,
        confirmDelete: flag,
      })
      expect([out.loop, out.showOvertime, out.notifications, out.confirmDelete]).toEqual([
        flag,
        flag,
        flag,
        flag,
      ])
    }
  })

  it('falls back per field for unknown choices and wrong types', () => {
    for (const bad of ['Fixed', 'hms', 1, ...JUNK]) {
      expect(synced({ timeStyle: bad, sound: 'beep' })).toEqual({
        ...SYNCED_DEFAULTS,
        sound: 'beep',
      })
    }
    for (const bad of ['h24', 'h11', '12', ...JUNK]) {
      expect(synced({ hourCycle: bad }).hourCycle).toBe('auto')
    }
    for (const bad of ['gong', 'custom', ...JUNK])
      expect(synced({ sound: bad }).sound).toBe('chime')
    for (const bad of [1, 0, 'true', 'false', ...JUNK]) {
      const out = synced({ loop: bad, showOvertime: bad, notifications: bad, confirmDelete: bad })
      expect(out).toEqual(SYNCED_DEFAULTS)
    }
  })

  it('clamps the volume to 0–1 without rounding it', () => {
    expect(synced({ volume: 0 }).volume).toBe(0)
    expect(synced({ volume: 1 }).volume).toBe(1)
    expect(synced({ volume: 0.333 }).volume).toBe(0.333)
    expect(synced({ volume: -0.5 }).volume).toBe(0)
    expect(synced({ volume: 80 }).volume).toBe(1)
    for (const bad of ['0.5', ...JUNK]) expect(synced({ volume: bad }).volume).toBe(0.8)
  })

  it('clamps auto-stop to 0–60 whole minutes', () => {
    const cases: [number, number][] = [
      [0, 0],
      [1, 1],
      [60, 60],
      [2.4, 2],
      [2.5, 3],
      [-5, 0],
      [90, 60],
    ]
    for (const [autoStopMinutes, expected] of cases) {
      expect(synced({ autoStopMinutes }).autoStopMinutes).toBe(expected)
    }
    for (const bad of ['5', ...JUNK])
      expect(synced({ autoStopMinutes: bad }).autoStopMinutes).toBe(0)
  })

  it('clamps each quick-add duration to 1 s – 24 h in whole seconds', () => {
    expect(synced({ quickAdd: [SECOND, 24 * HOUR, 90 * SECOND] }).quickAdd).toEqual([
      SECOND,
      24 * HOUR,
      90 * SECOND,
    ])
    expect(synced({ quickAdd: [0, -MINUTE, 25 * HOUR] }).quickAdd).toEqual([
      SECOND,
      SECOND,
      24 * HOUR,
    ])
    expect(synced({ quickAdd: [1499, 1500, 59_999.9] }).quickAdd).toEqual([
      SECOND,
      2 * SECOND,
      MINUTE,
    ])
  })

  it('falls back per quick-add chip, and for the whole list when it is not a list', () => {
    expect(synced({ quickAdd: [10 * SECOND, 'x', null] }).quickAdd).toEqual([
      10 * SECOND,
      MINUTE,
      5 * MINUTE,
    ])
    expect(synced({ quickAdd: [NaN, Infinity, 2 * MINUTE] }).quickAdd).toEqual([
      30 * SECOND,
      MINUTE,
      2 * MINUTE,
    ])
    expect(synced({ quickAdd: [10 * SECOND] }).quickAdd).toEqual([10 * SECOND, MINUTE, 5 * MINUTE])
    expect(synced({ quickAdd: [SECOND, 2 * SECOND, 3 * SECOND, 4 * SECOND] }).quickAdd).toEqual([
      SECOND,
      2 * SECOND,
      3 * SECOND,
    ])
    for (const bad of ['30,60,300', 30_000, { 0: 1000, 1: 2000, 2: 3000 }, ...JUNK.slice(0, 5)]) {
      expect(synced({ quickAdd: bad }).quickAdd).toEqual(SYNCED_DEFAULTS.quickAdd)
    }
  })

  describe('keymap', () => {
    it('keeps valid overrides, in action order, and empty lists that unbind an action', () => {
      const out = synced({ keymap: { lap: ['Shift+L', 'Mod+L'], reset: [], newTimer: ['t'] } })
      expect(out.keymap).toEqual({ reset: [], lap: ['Shift+L', 'Mod+L'], newTimer: ['t'] })
      expect(Object.keys(out.keymap)).toEqual(['reset', 'lap', 'newTimer'])
    })

    it('drops entries that are not actions, including prototype names and inherited keys', () => {
      const parsed = JSON.parse('{"__proto__":["x"],"constructor":["y"],"reset":["z"]}') as unknown
      expect(synced({ keymap: parsed }).keymap).toEqual({ reset: ['z'] })
      expect(synced({ keymap: { Reset: ['x'], fly: ['y'] } }).keymap).toEqual({})
      const inherited = Object.create({ reset: ['x'] }) as object
      expect(synced({ keymap: inherited }).keymap).toEqual({})
    })

    it('drops combos that are not strings, do not parse or are too long', () => {
      const long = `Ctrl+${'a'.repeat(70)}`
      const out = synced({ keymap: { reset: ['x', 42, null, 'Hyper+R', '', long, 'Shift+X'] } })
      expect(out.keymap).toEqual({ reset: ['x', 'Shift+X'] })
    })

    it('drops a list whose every combo is invalid, so the action keeps its default', () => {
      expect(synced({ keymap: { reset: ['Hyper+R', 7], lap: ['l'] } }).keymap).toEqual({
        lap: ['l'],
      })
    })

    it('drops values that are not lists', () => {
      expect(synced({ keymap: { reset: 'x', lap: { 0: 'l' }, mute: null } }).keymap).toEqual({})
    })

    it('keeps at most eight combos per action', () => {
      const many = ['a', 'b', 'c', 'd', 'g', 'h', 'i', 'j', 'k', 'o']
      expect(synced({ keymap: { reset: many } }).keymap.reset).toEqual(many.slice(0, 8))
    })

    it('falls back to no overrides for a keymap that is not an object', () => {
      for (const bad of [[['x']], 'reset=x', 42, ...JUNK]) {
        const out = synced({ keymap: bad })
        expect(out.keymap).toEqual({})
        expect(out.keymap).toBe(SYNCED_DEFAULTS.keymap)
      }
    })
  })
})

describe('validation as a whole', () => {
  it('never throws, and its output is valid: validating it again changes nothing', () => {
    fc.assert(
      fc.property(fc.anything({ withNullPrototype: true, withBoxedValues: true }), (input) => {
        const d = migrateDeviceSettings(input)
        const s = migrateSyncedSettings(input)
        expect(migrateDeviceSettings(d)).toEqual(d)
        expect(migrateSyncedSettings(s)).toEqual(s)
      }),
      { numRuns: 500 },
    )
  })

  it('keeps any valid settings as they are', () => {
    const deviceArb = fc.record({
      themeMode: fc.constantFrom(...THEME_MODES),
      seed: fc.oneof(
        fc.constant(''),
        fc.integer({ min: 0, max: 0xffffff }).map((n) => `#${n.toString(16).padStart(6, '0')}`),
      ),
      font: fc.constantFrom(...FONT_IDS),
      fontWeight: fc.integer({ min: 3, max: 7 }).map((n) => n * 100),
      digitScale: fc.double({ min: 0.75, max: 1.5, noNaN: true }),
      ringScale: fc.double({ min: 0.5, max: 2, noNaN: true }),
      density: fc.constantFrom(...DENSITIES),
      locale: fc.constantFrom(...LOCALES, 'auto' as const),
    })
    const chip = fc.integer({ min: 1, max: 86_400 }).map((s) => s * SECOND)
    const syncedArb = fc.record({
      timeStyle: fc.constantFrom(...TIME_STYLES),
      hourCycle: fc.constantFrom(...HOUR_CYCLES),
      quickAdd: fc.tuple(chip, chip, chip),
      sound: fc.constantFrom(...SOUND_IDS),
      volume: fc.double({ min: 0, max: 1, noNaN: true }),
      loop: fc.boolean(),
      autoStopMinutes: fc.integer({ min: 0, max: 60 }),
      showOvertime: fc.boolean(),
      notifications: fc.boolean(),
      confirmDelete: fc.boolean(),
      keymap: fc.dictionary(
        fc.constantFrom(...ACTION_IDS),
        fc.array(fc.constantFrom('x', 'Shift+Y', 'Mod+,', 'F4', 'Alt+ArrowUp'), { maxLength: 3 }),
      ),
    })
    fc.assert(
      fc.property(deviceArb, syncedArb, (d, s) => {
        expect(migrateDeviceSettings(d)).toEqual(d)
        expect(migrateSyncedSettings(s)).toEqual(s)
      }),
      { numRuns: 300 },
    )
  })
})

describe('runMigrations', () => {
  const steps = [
    (data: unknown) => ({ from: 1, data }),
    (data: unknown) => ({ from: 2, data }),
  ] as const

  it('runs every step from the data version on, in order', () => {
    expect(runMigrations('v1', 1, steps)).toEqual({ from: 2, data: { from: 1, data: 'v1' } })
    expect(runMigrations('v2', 2, steps)).toEqual({ from: 2, data: 'v2' })
  })

  it('returns data of the latest version as it is', () => {
    expect(runMigrations('v3', 3, steps)).toBe('v3')
    expect(runMigrations('v1', 1, [])).toBe('v1')
  })

  it('returns data from a newer app as it is, for the schema to read leniently', () => {
    expect(runMigrations('v9', 9, steps)).toBe('v9')
  })

  it('treats data without a usable version as current', () => {
    for (const version of [undefined, 0, -1, 1.5, NaN, Infinity]) {
      expect(runMigrations('?', version, steps)).toBe('?')
    }
  })
})

describe('migrations by version', () => {
  it('reads data of the current version, a newer one and none the same way', () => {
    const input = { themeMode: 'dark', future: true }
    for (const version of [undefined, SETTINGS_SCHEMA_VERSION, SETTINGS_SCHEMA_VERSION + 5, NaN]) {
      expect(migrateDeviceSettings(input, version)).toEqual({
        ...DEVICE_DEFAULTS,
        themeMode: 'dark',
      })
      expect(migrateSyncedSettings({ loop: false, future: 1 }, version)).toEqual({
        ...SYNCED_DEFAULTS,
        loop: false,
      })
    }
  })
})

describe('bindingsWith', () => {
  it('is the default bindings themselves when nothing is overridden', () => {
    expect(bindingsWith({})).toBe(DEFAULT_BINDINGS)
    expect(bindingsWith(SYNCED_DEFAULTS.keymap)).toBe(DEFAULT_BINDINGS)
  })

  it('replaces the overridden actions only', () => {
    const bindings = bindingsWith({ reset: ['x'], help: ['F1', 'Shift+/'] })
    expect(bindings.reset).toEqual(['x'])
    expect(bindings.help).toEqual(['F1', 'Shift+/'])
    for (const action of ACTION_IDS.filter((a) => a !== 'reset' && a !== 'help')) {
      expect(bindings[action]).toBe(DEFAULT_BINDINGS[action])
    }
    expect(Object.isFrozen(bindings)).toBe(true)
    expect(resolveAction(bindings, ev('x'), 'other')).toBe('reset')
    expect(resolveAction(bindings, ev('r'), 'other')).toBeNull()
    expect(resolveAction(bindings, ev('F1'), 'mac')).toBe('help')
  })

  it('unbinds an action overridden with an empty list', () => {
    const bindings = bindingsWith({ reset: [] })
    expect(bindings.reset).toEqual([])
    expect(resolveAction(bindings, ev('r'), 'other')).toBeNull()
  })

  it('ignores invalid overrides, keeping those actions on their defaults', () => {
    const junk = {
      reset: ['Hyper+R'],
      lap: 'x',
      fly: ['f'],
      help: [42, '?', 'Ctrl+'],
    } as unknown as KeymapOverrides
    const bindings = bindingsWith(junk)
    expect(bindings.reset).toBe(DEFAULT_BINDINGS.reset)
    expect(bindings.lap).toBe(DEFAULT_BINDINGS.lap)
    expect(bindings.help).toEqual(['?'])
    expect('fly' in bindings).toBe(false)
    expect(bindingsWith({ reset: ['Hyper+R'] })).toBe(DEFAULT_BINDINGS)
  })

  it('gives the same bindings for the same overrides object, and equal ones for equal objects', () => {
    const overrides: KeymapOverrides = { mute: ['Shift+M'] }
    expect(bindingsWith(overrides)).toBe(bindingsWith(overrides))
    expect(bindingsWith({ mute: ['Shift+M'] })).toEqual(bindingsWith(overrides))
  })

  it('gives the default bindings for non-objects from untyped code', () => {
    for (const junk of [null, undefined, 'x', 42]) {
      expect(bindingsWith(junk as unknown as KeymapOverrides)).toBe(DEFAULT_BINDINGS)
    }
  })

  it('works with validated settings, as the settings store uses it', () => {
    const settings = migrateSyncedSettings({ keymap: { newTimer: ['Shift+T'], palette: [] } })
    const bindings = bindingsWith(settings.keymap)
    expect(resolveAction(bindings, ev('T', { shiftKey: true }), 'other')).toBe('newTimer')
    expect(resolveAction(bindings, ev('n'), 'other')).toBeNull()
    expect(resolveAction(bindings, ev('k', { ctrlKey: true }), 'other')).toBeNull()
  })
})
