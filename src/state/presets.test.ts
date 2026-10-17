import { describe, expect, it } from 'vitest'

import { formatCountdown } from '../core'
import { BUILTIN_PRESETS, findPreset } from './presets'

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
