import { afterEach, describe, expect, it } from 'vitest'

import { formatCountdown, settings, timer } from '../../core'
import { setAppLocale } from '../../i18n'
import {
  canStep,
  durationFields,
  stepDelta,
  stepLabel,
  UNIT_MS,
  type DurationUnit,
} from './stepper'

describe('durationFields', () => {
  it('reads a compact readout under an hour as minutes and seconds', () => {
    expect(durationFields('5:00')).toEqual([
      { text: '5', unit: 'minutes' },
      { text: '00', unit: 'seconds' },
    ])
    expect(durationFields('0:00')).toEqual([
      { text: '0', unit: 'minutes' },
      { text: '00', unit: 'seconds' },
    ])
  })

  it('reads three fields as hours, minutes and seconds', () => {
    expect(durationFields('1:30:30')).toEqual([
      { text: '1', unit: 'hours' },
      { text: '30', unit: 'minutes' },
      { text: '30', unit: 'seconds' },
    ])
    // The fixed time style.
    expect(durationFields('00:04:53')).toEqual([
      { text: '00', unit: 'hours' },
      { text: '04', unit: 'minutes' },
      { text: '53', unit: 'seconds' },
    ])
  })

  it('keeps hours past two digits', () => {
    expect(durationFields('100:00:00').map((field) => field.text)).toEqual(['100', '00', '00'])
  })

  it.each([
    ['', 'empty'],
    ['5', 'a single field'],
    ['0.00', "a stopwatch's reading"],
    ['1:00:00.00', 'centiseconds'],
    ['1:02:03:04', 'four fields'],
    ['−0:12', 'overtime (U+2212)'],
    ['-0:12', 'a hyphen minus'],
    ['5:', 'an empty field'],
    [':00', 'an empty first field'],
    ['5: 00', 'a space'],
    ['５:００', 'non-ASCII digits'],
  ])('has no fields for %j (%s)', (text) => {
    expect(durationFields(text)).toEqual([])
  })

  it("finds a field for every unit of every compact and fixed countdown's shape", () => {
    for (const ms of [0, 59_000, 300_000, 3_599_000, 3_600_000, 5_430_000, 360_000_000]) {
      for (const style of settings.TIME_STYLES) {
        const text = formatCountdown(ms, style)
        const fields = durationFields(text)
        expect(fields.map((field) => field.text).join(':'), text).toBe(text)
        expect(fields.at(-1)?.unit, text).toBe('seconds')
      }
    }
  })
})

describe('canStep', () => {
  it('always steps up, even at zero and at the maximum', () => {
    for (const unit of ['hours', 'minutes', 'seconds'] as const) {
      expect(canStep(0, unit, 'up')).toBe(true)
      expect(canStep(timer.MAX_MS, unit, 'up')).toBe(true)
    }
  })

  it('steps down only while a whole unit is left', () => {
    // 0:59: a second can go, a minute cannot.
    expect(canStep(59_000, 'seconds', 'down')).toBe(true)
    expect(canStep(59_000, 'minutes', 'down')).toBe(false)
    expect(canStep(60_000, 'minutes', 'down')).toBe(true)
    // 00:05:00 (fixed style): no hour to take away.
    expect(canStep(300_000, 'hours', 'down')).toBe(false)
    expect(canStep(300_000, 'minutes', 'down')).toBe(true)
    expect(canStep(3_600_000, 'hours', 'down')).toBe(true)
    expect(canStep(30_000, 'minutes', 'down')).toBe(false)
    expect(canStep(0, 'seconds', 'down')).toBe(false)
  })

  it('never lets a step down clamp: an allowed one takes away exactly one unit', () => {
    for (const ms of [0, 999, 1_000, 59_000, 60_000, 300_000, 3_599_000, 3_600_000, 5_430_000]) {
      for (const unit of ['hours', 'minutes', 'seconds'] as const) {
        const after = timer.addTime(timer.createTimer(ms), stepDelta(unit, 'down'), 0).duration
        expect(after === ms - UNIT_MS[unit], `${String(ms)} ${unit}`).toBe(
          canStep(ms, unit, 'down'),
        )
      }
    }
  })
})

describe('stepDelta', () => {
  it('adds or takes away one unit of the field', () => {
    expect(stepDelta('hours', 'up')).toBe(3_600_000)
    expect(stepDelta('minutes', 'up')).toBe(60_000)
    expect(stepDelta('seconds', 'down')).toBe(-1_000)
    expect(stepDelta('hours', 'down')).toBe(-UNIT_MS.hours)
  })

  it('carries and clamps through the engine', () => {
    const idle = (ms: number) => timer.createTimer(ms)
    const step = (ms: number, unit: DurationUnit, direction: 'up' | 'down') =>
      timer.addTime(idle(ms), stepDelta(unit, direction), 0)
    // 1:00 less a second is 0:59; 0:59 and a second is 1:00.
    expect(step(60_000, 'seconds', 'down')).toEqual(idle(59_000))
    expect(step(59_000, 'seconds', 'up')).toEqual(idle(60_000))
    // 59:00 and a minute is an hour.
    expect(step(3_540_000, 'minutes', 'up')).toEqual(idle(3_600_000))
    // Never below zero.
    expect(step(30_000, 'minutes', 'down')).toEqual(idle(0))
    expect(step(0, 'seconds', 'down')).toEqual(idle(0))
  })
})

describe('stepLabel', () => {
  afterEach(() => {
    setAppLocale('en')
  })

  it('names every button by its unit and direction', () => {
    expect(stepLabel('hours', 'up')).toBe('Add an hour')
    expect(stepLabel('minutes', 'up')).toBe('Add a minute')
    expect(stepLabel('seconds', 'up')).toBe('Add a second')
    expect(stepLabel('hours', 'down')).toBe('Subtract an hour')
    expect(stepLabel('minutes', 'down')).toBe('Subtract a minute')
    expect(stepLabel('seconds', 'down')).toBe('Subtract a second')
  })

  it('follows the active locale', () => {
    const english = stepLabel('minutes', 'up')
    setAppLocale('ja')
    expect(stepLabel('minutes', 'up')).not.toBe(english)
    expect(stepLabel('minutes', 'up')).not.toBe('')
  })
})
