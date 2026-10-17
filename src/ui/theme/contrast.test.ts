import { describe, expect, it } from 'vitest'

import { contrastRatio, relativeLuminance } from './contrast'

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
  })

  it('matches the WCAG reference value for mid gray', () => {
    // #777777: channel 119/255 linearizes to about 0.18447.
    expect(relativeLuminance('#777777')).toBeCloseTo(0.18447, 4)
  })

  it('accepts uppercase hex', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10)
  })

  it('is NaN for malformed colors', () => {
    for (const bad of ['', '#fff', 'ffffff', '#gggggg', '#1234567', 'red']) {
      expect(relativeLuminance(bad)).toBeNaN()
    }
  })
})

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colors', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10)
    expect(contrastRatio('#3366cc', '#3366cc')).toBe(1)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#0b57d0', '#ffffff')).toBe(contrastRatio('#ffffff', '#0b57d0'))
  })

  it('matches a known pair: #777777 on white is about 4.48', () => {
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
  })

  it('is NaN when either color is malformed, so it never passes a threshold', () => {
    expect(contrastRatio('#000000', 'nope')).toBeNaN()
    expect(contrastRatio('nope', '#000000') >= 3).toBe(false)
  })
})
