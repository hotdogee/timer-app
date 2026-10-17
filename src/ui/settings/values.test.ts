import { afterEach, describe, expect, it } from 'vitest'

import { settings } from '../../core'
import { setAppLocale } from '../../i18n'
import {
  APP_VERSION,
  AUTO_STOP_CHOICES,
  autoStopChoices,
  autoStopLabel,
  percentText,
  timeStyleDescription,
} from './values'

afterEach(() => {
  setAppLocale('en')
})

describe('percentText', () => {
  it('shows whole percentages in the locale', () => {
    expect(percentText(1, 'en')).toBe('100%')
    expect(percentText(1.25, 'en')).toBe('125%')
    expect(percentText(0.8, 'ja')).toBe('80%')
    expect(percentText(0.75, 'zh-TW')).toBe('75%')
  })
})

describe('auto-stop choices', () => {
  it('offers never and whole minutes inside the setting range', () => {
    const range = settings.SETTING_RANGES.autoStopMinutes
    expect(AUTO_STOP_CHOICES[0]).toBe(0)
    for (const minutes of AUTO_STOP_CHOICES) {
      expect(Number.isInteger(minutes) && minutes >= range.min && minutes <= range.max).toBe(true)
    }
  })

  it('adds a valid current value that is not a choice, in order', () => {
    expect(autoStopChoices(5)).toBe(AUTO_STOP_CHOICES)
    expect(autoStopChoices(7)).toEqual([0, 1, 2, 3, 5, 7, 10, 15, 30, 60])
    expect(autoStopChoices(61)).toBe(AUTO_STOP_CHOICES)
    expect(autoStopChoices(2.5)).toBe(AUTO_STOP_CHOICES)
  })

  it('labels never and counts minutes with plurals', () => {
    expect(autoStopLabel(0)).toBe('Never')
    expect(autoStopLabel(1)).toBe('1 minute')
    expect(autoStopLabel(15)).toBe('15 minutes')
    setAppLocale('ja')
    expect(autoStopLabel(0)).toBe('しない')
    expect(autoStopLabel(15)).toBe('15 分')
  })
})

describe('timeStyleDescription', () => {
  it('shows the example in both styles', () => {
    expect(timeStyleDescription()).toBe('Compact shows 4:53, fixed shows 00:04:53')
  })
})

describe('APP_VERSION', () => {
  it('is the package version', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
