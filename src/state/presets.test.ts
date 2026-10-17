import { describe, expect, it } from 'vitest'

import { formatCountdown } from '../core'
import {
  BUILTIN_PRESETS,
  MAX_PRESET_DURATION,
  findPreset,
  isPresetDuration,
  presetName,
} from './presets'

describe('BUILTIN_PRESETS', () => {
  it('lists the spec presets in order: Tea 3:00, Pomodoro 25:00, Break 5:00, Eggs 7:00', () => {
    expect(BUILTIN_PRESETS.map((p) => `${p.name} ${formatCountdown(p.duration)}`)).toEqual([
      'Tea 3:00',
      'Pomodoro 25:00',
      'Break 5:00',
      'Eggs 7:00',
    ])
  })

  it('has unique ids and names', () => {
    expect(new Set(BUILTIN_PRESETS.map((p) => p.id)).size).toBe(BUILTIN_PRESETS.length)
    expect(new Set(BUILTIN_PRESETS.map((p) => p.name)).size).toBe(BUILTIN_PRESETS.length)
  })

  it('has positive whole-second durations', () => {
    for (const preset of BUILTIN_PRESETS) {
      expect(preset.duration).toBeGreaterThan(0)
      expect(preset.duration % 1000).toBe(0)
    }
  })

  it('is frozen, list and entries', () => {
    expect(Object.isFrozen(BUILTIN_PRESETS)).toBe(true)
    for (const preset of BUILTIN_PRESETS) expect(Object.isFrozen(preset)).toBe(true)
  })
})

describe('findPreset', () => {
  it('finds a preset by id', () => {
    expect(findPreset('pomodoro')?.name).toBe('Pomodoro')
  })

  it('returns undefined for an unknown id', () => {
    expect(findPreset('coffee')).toBeUndefined()
    expect(findPreset('')).toBeUndefined()
  })

  it('searches the given list', () => {
    const custom = [{ id: 'coffee', name: 'Coffee', duration: 240_000 }]
    expect(findPreset('coffee', custom)?.duration).toBe(240_000)
    expect(findPreset('tea', custom)).toBeUndefined()
  })
})

describe('presetName', () => {
  it('trims a name and refuses a blank one', () => {
    expect(presetName('  Green tea ')).toBe('Green tea')
    expect(presetName('お茶')).toBe('お茶')
    expect(presetName('')).toBeNull()
    expect(presetName(' \t\n ')).toBeNull()
  })
})

describe('isPresetDuration', () => {
  it('accepts positive finite spans up to the engine limit', () => {
    expect(isPresetDuration(1)).toBe(true)
    expect(isPresetDuration(25 * 60_000)).toBe(true)
    expect(isPresetDuration(MAX_PRESET_DURATION)).toBe(true)
  })

  it('refuses zero, negative, non-finite and oversized durations', () => {
    for (const duration of [
      0,
      -0,
      -1,
      Number.NaN,
      Infinity,
      -Infinity,
      MAX_PRESET_DURATION + 1e3,
    ]) {
      expect(isPresetDuration(duration)).toBe(false)
    }
  })

  it('accepts every built-in preset', () => {
    expect(BUILTIN_PRESETS.every((p) => isPresetDuration(p.duration))).toBe(true)
  })
})
