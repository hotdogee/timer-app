import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { digits } from '../../core'
import {
  PRESET_RANGE,
  bufferDuration,
  bufferFromDuration,
  bufferFromText,
  durationText,
  inRange,
  typedText,
} from './duration'

describe('bufferFromText', () => {
  it('reads an edit of the shown text like typing on a card', () => {
    expect(bufferFromText('00:01:305')).toBe('1305') // a 5 typed after 00:01:30
    expect(bufferFromText('00:01:3')).toBe('13') // Backspace
    expect(bufferFromText('5')).toBe('5') // everything selected, then 5
    expect(bufferFromText('')).toBe('')
    expect(bufferFromText('99:99:991')).toBe('999999') // a seventh digit is ignored
    expect(bufferFromText('1:30')).toBe('130') // pasted
    expect(bufferFromText('abc')).toBe('')
  })

  it('ignores locale digits and survives untyped input', () => {
    expect(bufferFromText('١٢')).toBe('')
    expect(bufferFromText(42 as unknown as string)).toBe('')
  })

  it('always gives a valid buffer', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(digits.isDigitBuffer(bufferFromText(text))).toBe(true)
      }),
    )
  })
})

describe('bufferFromDuration', () => {
  it('types a duration as HH:MM:SS', () => {
    expect(bufferFromDuration(180_000)).toBe('300')
    expect(bufferFromDuration(5_400_000)).toBe('13000')
    expect(bufferFromDuration(30_000)).toBe('30')
    expect(bufferFromDuration(1_500)).toBe('1') // whole seconds, rounded down
    expect(typedText(bufferFromDuration(86_400_000))).toBe('24:00:00')
  })

  it('is empty for zero, invalid and too long durations', () => {
    expect(bufferFromDuration(0)).toBe('')
    expect(bufferFromDuration(-1)).toBe('')
    expect(bufferFromDuration(Number.NaN)).toBe('')
    expect(bufferFromDuration(Number.POSITIVE_INFINITY)).toBe('')
    expect(bufferFromDuration(100 * 3_600_000)).toBe('')
  })

  it('round-trips every whole-second duration under 100 hours', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 * 3600 - 1 }), (seconds) => {
        expect(bufferDuration(bufferFromDuration(seconds * 1000))).toBe(seconds * 1000)
      }),
    )
  })
})

describe('typedText and bufferDuration', () => {
  it('show what was typed and commit it normalized', () => {
    expect(typedText('90')).toBe('00:00:90')
    expect(bufferDuration('90')).toBe(90_000)
    expect(typedText('')).toBe('00:00:00')
    expect(bufferDuration('')).toBe(0)
  })
})

describe('inRange', () => {
  it('includes both bounds', () => {
    const range = { min: 1000, max: 5000 }
    expect(inRange(1000, range)).toBe(true)
    expect(inRange(5000, range)).toBe(true)
    expect(inRange(999, range)).toBe(false)
    expect(inRange(5001, range)).toBe(false)
    expect(inRange(Number.NaN, range)).toBe(false)
  })

  it('takes presets from a second to 99:59:59', () => {
    expect(inRange(0, PRESET_RANGE)).toBe(false)
    expect(inRange(1000, PRESET_RANGE)).toBe(true)
    expect(inRange(bufferDuration('995959'), PRESET_RANGE)).toBe(true)
    expect(inRange(bufferDuration('999999'), PRESET_RANGE)).toBe(false)
  })
})

describe('durationText', () => {
  it('follows the time style', () => {
    expect(durationText(180_000, 'compact')).toBe('3:00')
    expect(durationText(180_000, 'fixed')).toBe('00:03:00')
    expect(durationText(5_400_000, 'compact')).toBe('1:30:00')
  })
})
