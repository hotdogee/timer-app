/**
 * The translation files themselves (`messages/*.json`): the same keys and the same parameters in
 * every locale, no blanks, and checks for slips that compile fine but read wrong (untranslated
 * text, Simplified characters in Traditional Chinese, ASCII punctuation in CJK text).
 */
import { describe, expect, it } from 'vitest'

import enText from '../../messages/en.json?raw'
import jaText from '../../messages/ja.json?raw'
import zhTwText from '../../messages/zh-TW.json?raw'
import type { Locale } from './locale.svelte'

/** One message: a pattern, or Paraglide's variant form (declarations, selectors, match). */
interface Variant {
  readonly declarations?: readonly string[]
  readonly selectors?: readonly string[]
  readonly match?: Readonly<Record<string, string>>
}
type Message = string | readonly Variant[]
type Catalog = Readonly<Record<string, Message>>

const SCHEMA = 'https://inlang.com/schema/inlang-message-format'

function parse(text: string): { schema: unknown; messages: Catalog } {
  const { $schema: schema, ...messages } = JSON.parse(text) as Record<string, Message>
  return { schema, messages }
}

const FILES: Readonly<Record<Locale, string>> = { en: enText, 'zh-TW': zhTwText, ja: jaText }
const CATALOGS = Object.fromEntries(
  Object.entries(FILES).map(([locale, text]) => [locale, parse(text).messages]),
) as Record<Locale, Catalog>
const EN = CATALOGS.en

/** Every pattern of a message (one, or one per variant). */
function patterns(message: Message): string[] {
  if (typeof message === 'string') return [message]
  return message.flatMap((variant) => Object.values(variant.match ?? {}))
}

/** The inputs a message takes: `{name}` placeholders and `input` declarations, minus locals. */
function inputsOf(message: Message): string[] {
  const inputs = new Set<string>()
  const locals = new Set<string>()
  if (typeof message !== 'string') {
    for (const variant of message) {
      for (const declaration of variant.declarations ?? []) {
        const [kind, name] = declaration.trim().split(/\s+/)
        if (name === undefined) continue
        if (kind === 'input') inputs.add(name)
        if (kind === 'local') locals.add(name)
      }
    }
  }
  for (const pattern of patterns(message)) {
    for (const [, name] of pattern.matchAll(/\{([^{}]+)\}/g)) {
      if (name !== undefined && !locals.has(name)) inputs.add(name)
    }
  }
  return [...inputs].sort()
}

const KEYS = Object.keys(EN)
const TRANSLATED: readonly Exclude<Locale, 'en'>[] = ['zh-TW', 'ja']

/** Messages that read the same in every language: the app's name and the font names. */
const SAME_IN_EVERY_LOCALE = new Set([
  'app_name',
  'settings_font_roboto_flex',
  'settings_font_inter',
])

describe('message files', () => {
  it('declare the inlang message format', () => {
    for (const [locale, text] of Object.entries(FILES)) {
      expect(parse(text).schema, locale).toBe(SCHEMA)
    }
  })

  it('have the same keys in every locale', () => {
    for (const locale of TRANSLATED) {
      expect(Object.keys(CATALOGS[locale]).sort(), locale).toEqual([...KEYS].sort())
    }
  })

  it('give every message the same parameters in every locale', () => {
    for (const key of KEYS) {
      const expected = inputsOf(EN[key] ?? '')
      for (const locale of TRANSLATED) {
        expect(inputsOf(CATALOGS[locale][key] ?? ''), `${locale} ${key}`).toEqual(expected)
      }
    }
  })

  it('use lower snake case keys', () => {
    for (const key of KEYS) expect(key, key).toMatch(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/)
  })

  it('have no blank, padded or double-spaced text', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, message] of Object.entries(catalog)) {
        for (const pattern of patterns(message)) {
          expect(pattern.trim(), `${locale} ${key}`).not.toBe('')
          expect(pattern, `${locale} ${key}`).toBe(pattern.trim())
          expect(pattern, `${locale} ${key}`).not.toContain('  ')
        }
      }
    }
  })

  it('never contain characters that would end a template literal', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, message] of Object.entries(catalog)) {
        for (const pattern of patterns(message)) {
          expect(pattern, `${locale} ${key}`).not.toMatch(/[`\\]|\$\{/)
        }
      }
    }
  })

  it('give English plural forms for one and other where a count is selected', () => {
    for (const [key, message] of Object.entries(EN)) {
      if (typeof message === 'string') continue
      for (const variant of message) {
        expect(Object.keys(variant.match ?? {}).sort(), key).toEqual(
          ['countPlural=one', 'countPlural=other'].sort(),
        )
      }
    }
  })
})

describe('translations', () => {
  it('translate every message except names', () => {
    for (const locale of TRANSLATED) {
      const same = KEYS.filter(
        (key) => JSON.stringify(CATALOGS[locale][key]) === JSON.stringify(EN[key]),
      )
      expect(same, locale).toEqual(KEYS.filter((key) => SAME_IN_EVERY_LOCALE.has(key)))
    }
  })

  it('use the agreed terms', () => {
    const terms: Readonly<Record<(typeof TRANSLATED)[number], Readonly<Record<string, string>>>> = {
      'zh-TW': {
        card_default_name_timer: '計時器',
        card_default_name_stopwatch: '碼錶',
        laps_lap: '圈數',
        card_times_up: '時間到',
        notification_times_up: '時間到',
        settings_section_presets: '預設集',
        settings_title: '設定',
      },
      ja: {
        card_default_name_timer: 'タイマー',
        card_default_name_stopwatch: 'ストップウォッチ',
        laps_lap: 'ラップ',
        card_times_up: '時間です',
        notification_times_up: '時間です',
        settings_section_presets: 'プリセット',
        settings_title: '設定',
      },
    }
    for (const locale of TRANSLATED) {
      for (const [key, term] of Object.entries(terms[locale])) {
        expect(CATALOGS[locale][key], `${locale} ${key}`).toBe(term)
      }
    }
  })

  it('write Traditional Chinese without Simplified characters or kana', () => {
    // Simplified forms of characters these messages use (這設時間計鐘刪復載鍵顯選擇…).
    const simplified =
      /[这设时间计钟删复载键显选择导览单总编辑项应无关开动态录码铃页发档资执继续为预输结浏语视萤们么体声号数]/
    for (const [key, message] of Object.entries(CATALOGS['zh-TW'])) {
      for (const pattern of patterns(message)) {
        expect(pattern, key).not.toMatch(simplified)
        expect(pattern, key).not.toMatch(/[぀-ヿ]/)
      }
    }
  })

  it('write Japanese without Chinese-only simplified characters', () => {
    const chineseOnly =
      /[这设时间计钟删复载键显选择导览单总编辑项应无关开动态录码铃页发档资执继续为预输结浏语视萤们么]/
    for (const [key, message] of Object.entries(CATALOGS.ja)) {
      for (const pattern of patterns(message)) expect(pattern, key).not.toMatch(chineseOnly)
    }
  })

  it('use full-width punctuation after CJK text', () => {
    const asciiAfterCjk = /[぀-ヿ一-鿿「」][,.;:?!]/
    for (const locale of TRANSLATED) {
      for (const [key, message] of Object.entries(CATALOGS[locale])) {
        for (const pattern of patterns(message)) {
          expect(pattern, `${locale} ${key}`).not.toMatch(asciiAfterCjk)
        }
      }
    }
  })

  it('keep the short labels on cards and the action bar short', () => {
    const short = [
      'card_times_up',
      'action_bar_timer',
      'action_bar_stopwatch',
      'card_start',
      'card_pause',
      'card_resume',
      'card_reset',
      'card_dismiss',
      'card_restart',
      'card_lap',
    ]
    for (const locale of TRANSLATED) {
      for (const key of short) {
        const text = CATALOGS[locale][key]
        expect(
          typeof text === 'string' && text.length <= 8,
          `${locale} ${key}: ${JSON.stringify(text)}`,
        ).toBe(true)
      }
    }
  })
})
