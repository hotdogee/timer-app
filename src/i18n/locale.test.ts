import { afterEach, describe, expect, it, vi } from 'vitest'

import { settings } from '../core'
import { getLocale, locales as paraglideLocales } from '../paraglide/runtime.js'
import {
  BASE_LOCALE,
  LOCALES,
  LOCALE_NAMES,
  applyLocaleSetting,
  browserLanguages,
  isLocale,
  localeState,
  matchLanguage,
  resolveLocale,
  setAppLocale,
  type Locale,
} from './locale.svelte'

afterEach(() => {
  vi.unstubAllGlobals()
  setAppLocale('en')
})

describe('locales', () => {
  it('are the settings locales and the compiled ones, English first and as the base', () => {
    expect(LOCALES).toEqual(['en', 'zh-TW', 'ja'])
    expect(LOCALES).toEqual(settings.LOCALES)
    expect(LOCALES).toEqual(paraglideLocales)
    expect(BASE_LOCALE).toBe('en')
  })

  it('each have their own name in their own language', () => {
    expect(LOCALE_NAMES).toEqual({ en: 'English', 'zh-TW': '繁體中文', ja: '日本語' })
    expect(Object.keys(LOCALE_NAMES)).toEqual([...LOCALES])
  })

  it('are recognized only when spelled exactly', () => {
    for (const locale of LOCALES) expect(isLocale(locale)).toBe(true)
    for (const value of ['zh-tw', 'ZH-TW', 'zh', 'ja-JP', 'en-US', 'auto', '', null, 1, {}]) {
      expect(isLocale(value), JSON.stringify(value)).toBe(false)
    }
  })
})

describe('matchLanguage', () => {
  const cases: [string, Locale | null][] = [
    // Traditional Chinese: Taiwan, Hong Kong, Macau, or the Hant script anywhere.
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-MO', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['zh-Hant-HK', 'zh-TW'],
    ['zh-Hant-CN', 'zh-TW'],
    ['zh-Hant-SG', 'zh-TW'],
    ['zh-hant', 'zh-TW'],
    ['ZH-tw', 'zh-TW'],
    ['zh_TW', 'zh-TW'],
    ['zh-TW-u-ca-chinese', 'zh-TW'],
    ['zh-cmn-Hant-TW', 'zh-TW'],
    ['zh-yue-HK', 'zh-TW'],
    ['  zh-TW  ', 'zh-TW'],
    // Simplified Chinese continues to the next language.
    ['zh', null],
    ['zh-CN', null],
    ['zh-SG', null],
    ['zh-MY', null],
    ['zh-Hans', null],
    ['zh-Hans-CN', null],
    ['zh-Hans-TW', null],
    ['zh-Hans-HK', null],
    ['zh-u-rg-twzzzz', null],
    ['zh-x-tw', null],
    // Japanese and English, any region.
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['JA-jp', 'ja'],
    ['ja-JP-u-ca-japanese', 'ja'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['en-IN', 'en'],
    ['EN', 'en'],
    // Everything else, including languages that merely start with the same letters.
    ['fr-FR', null],
    ['de', null],
    ['ko-KR', null],
    ['yue-Hant-HK', null],
    ['jv', null],
    ['jbo', null],
    ['eng', null],
    ['', null],
    ['*', null],
    ['i-klingon', null],
    ['-', null],
  ]

  it.each(cases)('maps %j to %j', (tag, expected) => {
    expect(matchLanguage(tag)).toBe(expected)
  })

  it('ignores input that is not a string', () => {
    expect(matchLanguage(undefined as unknown as string)).toBeNull()
    expect(matchLanguage(42 as unknown as string)).toBeNull()
  })
})

describe('resolveLocale', () => {
  it('uses an explicit setting whatever the browser says', () => {
    for (const locale of LOCALES) {
      expect(resolveLocale(locale, ['ja-JP', 'zh-TW'])).toBe(locale)
      expect(resolveLocale(locale, [])).toBe(locale)
      expect(resolveLocale(locale, undefined)).toBe(locale)
    }
  })

  it('takes the first browser language that maps, in order', () => {
    expect(resolveLocale('auto', ['ja-JP', 'en-US'])).toBe('ja')
    expect(resolveLocale('auto', ['en-US', 'ja-JP'])).toBe('en')
    expect(resolveLocale('auto', ['zh-HK', 'en'])).toBe('zh-TW')
    expect(resolveLocale('auto', ['zh-Hant', 'ja'])).toBe('zh-TW')
  })

  it('skips languages it does not speak, Simplified Chinese included', () => {
    expect(resolveLocale('auto', ['fr-FR', 'de', 'ja'])).toBe('ja')
    expect(resolveLocale('auto', ['zh-CN', 'zh-TW'])).toBe('zh-TW')
    expect(resolveLocale('auto', ['zh-CN', 'ja-JP', 'en'])).toBe('ja')
    expect(resolveLocale('auto', ['ko', 'zh-Hans-TW', 'en-GB'])).toBe('en')
  })

  it('falls back to English', () => {
    expect(resolveLocale('auto', ['fr', 'zh-CN', 'ko'])).toBe('en')
    expect(resolveLocale('auto', [])).toBe('en')
    expect(resolveLocale('auto', undefined)).toBe('en')
    expect(resolveLocale('auto', [''])).toBe('en')
  })

  it('treats a setting that is not a locale as automatic', () => {
    const broken = 'klingon' as unknown as Locale
    expect(resolveLocale(broken, ['ja'])).toBe('ja')
    expect(resolveLocale('zh-tw' as unknown as Locale, [])).toBe('en')
  })
})

describe('browserLanguages', () => {
  it('reads navigator.languages, else navigator.language, else nothing', () => {
    expect(browserLanguages({ languages: ['ja-JP', 'en'], language: 'ja-JP' })).toEqual([
      'ja-JP',
      'en',
    ])
    expect(browserLanguages({ languages: [], language: 'zh-TW' })).toEqual(['zh-TW'])
    expect(browserLanguages({ language: 'en-GB' })).toEqual(['en-GB'])
    expect(browserLanguages({ languages: [], language: '' })).toEqual([])
    expect(browserLanguages({})).toEqual([])
  })

  it('reads the global navigator by default, and nothing without one', () => {
    vi.stubGlobal('navigator', { languages: ['zh-HK', 'en'], language: 'zh-HK' })
    expect(browserLanguages()).toEqual(['zh-HK', 'en'])
    vi.stubGlobal('navigator', undefined)
    expect(browserLanguages()).toEqual([])
  })
})

describe('setAppLocale', () => {
  it('switches the reactive locale and Paraglide’s, without a document', () => {
    expect(typeof document).toBe('undefined')
    expect(localeState.current).toBe('en')
    setAppLocale('ja')
    expect(localeState.current).toBe('ja')
    expect(getLocale()).toBe('ja')
    setAppLocale('zh-TW')
    expect(localeState.current).toBe('zh-TW')
    expect(getLocale()).toBe('zh-TW')
  })

  it('switches to English for something that is not a locale', () => {
    setAppLocale('ja')
    setAppLocale('fr' as unknown as Locale)
    expect(localeState.current).toBe('en')
    expect(getLocale()).toBe('en')
  })
})

describe('applyLocaleSetting', () => {
  it('resolves the setting against the languages, applies it and returns it', () => {
    expect(applyLocaleSetting('auto', ['zh-MO'])).toBe('zh-TW')
    expect(localeState.current).toBe('zh-TW')
    expect(applyLocaleSetting('ja', ['en'])).toBe('ja')
    expect(localeState.current).toBe('ja')
    expect(applyLocaleSetting('auto', ['ko'])).toBe('en')
    expect(localeState.current).toBe('en')
  })

  it('follows the browser languages by default', () => {
    vi.stubGlobal('navigator', { languages: ['fr', 'ja-JP'], language: 'fr' })
    expect(applyLocaleSetting('auto')).toBe('ja')
    vi.stubGlobal('navigator', undefined)
    expect(applyLocaleSetting('auto')).toBe('en')
  })
})
