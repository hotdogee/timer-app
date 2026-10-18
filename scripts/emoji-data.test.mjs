import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import { LOCALES } from '../src/core/settings.ts'
import { EMOJI_LOCALES, emojiDataset } from './emoji-data.mjs'

const load = createRequire(import.meta.url)
/** @type {{ emoji: string, order?: number, skins?: { emoji: string }[] }[]} */
const SOURCE = load('emojibase-data/en/data.json')

const GROUP_KEYS = [
  'smileys-emotion',
  'people-body',
  'animals-nature',
  'food-drink',
  'travel-places',
  'activities',
  'objects',
  'symbols',
  'flags',
]

/** The entry for `emoji` in `locale`'s dataset. */
function entryOf(locale, emoji) {
  return emojiDataset(locale).emoji.find(([text]) => text === emoji)
}

describe('EMOJI_LOCALES', () => {
  it('are the app’s languages', () => {
    expect([...EMOJI_LOCALES]).toEqual([...LOCALES])
  })

  it('are the only languages with data', () => {
    expect(() => emojiDataset('fr')).toThrow(/No emoji data for "fr"/)
  })
})

describe('groups', () => {
  it('follow emojibase’s order, without the components', () => {
    for (const locale of EMOJI_LOCALES) {
      expect(emojiDataset(locale).groups.map(({ key }) => key)).toEqual(GROUP_KEYS)
    }
  })

  it('are named in the language, first letter upper-cased', () => {
    expect(emojiDataset('en').groups.map(({ label }) => label)).toEqual([
      'Smileys & emotion',
      'People & body',
      'Animals & nature',
      'Food & drink',
      'Travel & places',
      'Activities',
      'Objects',
      'Symbols',
      'Flags',
    ])
    expect(emojiDataset('zh-TW').groups[3]?.label).toBe('食物和飲料')
    expect(emojiDataset('ja').groups[3]?.label).toBe('飲み物・食べ物')
  })
})

describe('emoji', () => {
  it('are tuples of text, label, tags, group index and version', () => {
    for (const locale of EMOJI_LOCALES) {
      const { emoji, groups } = emojiDataset(locale)
      expect(emoji.length).toBeGreaterThan(1800)
      for (const entry of emoji) {
        expect(entry).toHaveLength(5)
        const [text, label, tags, group, version] = entry
        expect(typeof text).toBe('string')
        expect(label).not.toBe('')
        expect(typeof tags).toBe('string')
        expect(tags).toBe(tags.trim())
        expect(Number.isInteger(group) && group >= 0 && group < groups.length).toBe(true)
        expect(typeof version).toBe('number')
      }
    }
  })

  it('name a known emoji in each language, with English words in the others', () => {
    expect(entryOf('en', '🍵')).toEqual([
      '🍵',
      'teacup without handle',
      'beverage cup drink handle oolong tea teacup',
      3,
      0.6,
    ])
    const zh = entryOf('zh-TW', '🍵')
    expect(zh?.[1]).toBe('熱茶')
    expect(zh?.[2].split(' ')).toEqual(
      expect.arrayContaining(['茶', 'teacup', 'without', 'handle', 'tea', 'oolong']),
    )
    const ja = entryOf('ja', '🍵')
    expect(ja?.[1]).toBe('湯飲み')
    expect(ja?.[2]).toContain('teacup without handle')
    expect(emojiDataset('en').groups[zh?.[3] ?? -1]?.key).toBe('food-drink')
  })

  it('leave out skin tones, the components and the lone regional indicators', () => {
    const texts = new Set(emojiDataset('en').emoji.map(([text]) => text))
    for (const entry of SOURCE) {
      for (const skin of entry.skins ?? []) expect(texts.has(skin.emoji)).toBe(false)
    }
    for (const text of texts) {
      expect(text).not.toMatch(/[\u{1F3FB}-\u{1F3FF}]/u)
      expect(text).not.toMatch(/^\p{Regional_Indicator}$/u)
    }
    expect(texts.has('🦰')).toBe(false)
    // Flags are pairs of regional indicators, and stay.
    expect(texts.has('🇹🇼')).toBe(true)
    // The same emoji in every language.
    for (const locale of EMOJI_LOCALES) {
      expect(emojiDataset(locale).emoji.map(([text]) => text)).toEqual([...texts])
    }
  })

  it('come in Unicode’s emoji order', () => {
    const order = new Map(SOURCE.map((entry) => [entry.emoji, entry.order ?? NaN]))
    const orders = emojiDataset('en').emoji.map(([text]) => order.get(text) ?? NaN)
    expect(orders.every((n, i) => i === 0 || n > (orders[i - 1] ?? NaN))).toBe(true)
    expect(emojiDataset('en').emoji[0]?.[0]).toBe('😀')
  })
})

describe('probes', () => {
  it('cover every emoji version from 11 on, in order', () => {
    const { probes } = emojiDataset('en')
    expect(probes.map(({ version }) => version)).toEqual([
      11, 12, 12.1, 13, 13.1, 14, 15, 15.1, 16, 17, 18,
    ])
  })

  it('are single code points, or ZWJ sequences with a base for versions of sequences only', () => {
    const { probes, emoji } = emojiDataset('en')
    const versionOf = new Map(emoji.map(([text, , , , version]) => [text, version]))
    for (const probe of probes) {
      expect(versionOf.get(probe.emoji)).toBe(probe.version)
      if ([12.1, 13.1, 15.1].includes(probe.version)) {
        expect(probe.emoji).toContain('‍')
        expect(probe.base).toBe(String.fromCodePoint(probe.emoji.codePointAt(0) ?? 0))
      } else {
        expect([...probe.emoji]).toHaveLength(1)
        expect(probe).not.toHaveProperty('base')
      }
    }
    expect(probes[0]).toEqual({ version: 11, emoji: '🥰' })
  })

  it('are the same in every language', () => {
    for (const locale of EMOJI_LOCALES) {
      expect(emojiDataset(locale).probes).toEqual(emojiDataset('en').probes)
    }
  })
})
