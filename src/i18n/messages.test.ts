import { afterEach, describe, expect, it } from 'vitest'

import { exportFormat, keymap } from '../core'
import { m as compiled } from '../paraglide/messages.js'
import { getLocale } from '../paraglide/runtime.js'
import { actionName, importErrorMessage } from './labels'
import { LOCALES, localeState, setAppLocale } from './locale.svelte'
import { m } from './messages.svelte'

afterEach(() => {
  setAppLocale('en')
})

describe('m', () => {
  it('is Paraglide’s namespace of compiled messages, each a function', () => {
    expect(m).toBe(compiled)
    for (const [key, value] of Object.entries(m)) expect(typeof value, key).toBe('function')
    expect(Object.keys(m).length).toBeGreaterThan(200)
  })

  it('reads its locale from the reactive state, through Paraglide’s getLocale', () => {
    expect(getLocale()).toBe(localeState.current)
    setAppLocale('ja')
    expect(getLocale()).toBe('ja')
    expect(localeState.current).toBe('ja')
  })

  it('speaks English until the locale changes', () => {
    expect(m.card_start()).toBe('Start')
    expect(m.card_times_up()).toBe("Time's up")
  })

  it('follows setAppLocale on every call', () => {
    setAppLocale('zh-TW')
    expect(m.card_start()).toBe('開始')
    expect(m.card_default_name_timer()).toBe('計時器')
    setAppLocale('ja')
    expect(m.card_start()).toBe('開始')
    expect(m.card_default_name_timer()).toBe('タイマー')
    expect(m.card_times_up()).toBe('時間です')
    setAppLocale('en')
    expect(m.card_default_name_timer()).toBe('Timer')
  })

  it('fills in named parameters in each locale', () => {
    const expected = { en: 'Delete Tea', 'zh-TW': '刪除「Tea」', ja: '「Tea」を削除' }
    for (const locale of LOCALES) {
      setAppLocale(locale)
      expect(m.card_delete({ name: 'Tea' })).toBe(expected[locale])
    }
  })

  it('lets an explicit locale option win over the active locale', () => {
    setAppLocale('ja')
    expect(m.card_pause({}, { locale: 'en' })).toBe('Pause')
    expect(m.card_pause({}, { locale: 'zh-TW' })).toBe('暫停')
    expect(m.card_pause()).toBe('一時停止')
  })

  it('chooses English plural forms by count, and one form in Chinese and Japanese', () => {
    expect(m.data_count_cards({ count: 1 })).toBe('1 card')
    expect(m.data_count_cards({ count: 0 })).toBe('0 cards')
    expect(m.data_count_cards({ count: 12 })).toBe('12 cards')
    expect(m.data_count_presets({ count: 1 })).toBe('1 preset')
    expect(m.settings_auto_stop_minutes({ count: 1 })).toBe('1 minute')
    expect(m.settings_auto_stop_minutes({ count: 5 })).toBe('5 minutes')
    setAppLocale('zh-TW')
    expect(m.data_count_cards({ count: 1 })).toBe('1 張卡片')
    expect(m.data_count_cards({ count: 3 })).toBe('3 張卡片')
    setAppLocale('ja')
    expect(m.data_count_presets({ count: 4 })).toBe('プリセット 4 件')
  })

  it('composes the import confirmation from counted parts', () => {
    const parts = (cards: number, presets: number) => ({
      cards: m.data_count_cards({ count: cards }),
      presets: m.data_count_presets({ count: presets }),
    })
    const now = parts(1, 4)
    const file = parts(3, 1)
    const text = () =>
      m.data_import_confirm({
        cards: now.cards,
        presets: now.presets,
        fileCards: file.cards,
        filePresets: file.presets,
      })
    expect(text()).toBe(
      'Replace your 1 card and 4 presets with 3 cards and 1 preset from this file?',
    )
  })
})

describe('actionName', () => {
  it('names every keyboard action, each differently, in every locale', () => {
    for (const locale of LOCALES) {
      setAppLocale(locale)
      const names = keymap.ACTION_IDS.map(actionName)
      for (const name of names) expect(name.trim()).not.toBe('')
      expect(new Set(names).size, locale).toBe(names.length)
    }
  })

  it('follows the locale', () => {
    expect(actionName('toggle')).toBe('Start or pause')
    setAppLocale('ja')
    expect(actionName('settings')).toBe('設定')
  })
})

describe('importErrorMessage', () => {
  it('explains every import failure, each differently, in every locale', () => {
    for (const locale of LOCALES) {
      setAppLocale(locale)
      const texts = exportFormat.EXPORT_ERROR_REASONS.map(importErrorMessage)
      for (const text of texts) expect(text.trim()).not.toBe('')
      expect(new Set(texts).size, locale).toBe(texts.length)
    }
  })

  it('follows the locale', () => {
    expect(importErrorMessage('not-json')).toBe("The file isn't valid JSON.")
    setAppLocale('zh-TW')
    expect(importErrorMessage('not-json')).toBe('這個檔案不是有效的 JSON。')
  })
})
