import { describe, expect, it } from 'vitest'

import type { EmojiEntry } from './data'
import { searchEmoji } from './search'

/** A few emoji as the English dataset has them. */
const EN: EmojiEntry[] = [
  ['☺️', 'smiling face', 'face outlined relaxed smile', 0, 0.6],
  ['🧋', 'bubble tea', 'boba bubble milk pearl tea', 3, 13],
  ['🍵', 'teacup without handle', 'beverage cup drink handle oolong tea teacup', 3, 0.6],
  ['🫖', 'teapot', 'drink pot tea', 3, 13],
  ['☕', 'hot beverage', 'beverage coffee drink hot steaming tea', 3, 0.6],
  ['🦖', 'T-Rex', 'trex tyrannosaurus rex', 2, 5],
  ['🇹🇼', 'flag: Taiwan', 'TW', 8, 2],
  ['🔟', 'keycap: 10', 'keycap', 7, 0.6],
]

/** The same emoji as the Chinese dataset has them, English words appended to the tags. */
const ZH: EmojiEntry[] = [
  ['🧋', '珍珠奶茶', '奶茶 珍珠 bubble tea boba milk pearl', 3, 13],
  ['🍵', '熱茶', '無柄茶杯 茶 茶杯 teacup without handle beverage cup drink tea', 3, 0.6],
  ['🫖', '茶壺', '壺 茶 teapot drink pot tea', 3, 13],
  ['☕', '熱飲', '咖啡 熱 飲料 hot beverage coffee drink tea', 3, 0.6],
]

const found = (entries: readonly EmojiEntry[], query: string): string[] =>
  searchEmoji(entries, query).map(([emoji]) => emoji)

describe('searchEmoji', () => {
  it('finds nothing for a blank query: the picker shows the groups', () => {
    expect(searchEmoji(EN, '')).toEqual([])
    expect(searchEmoji(EN, '   ')).toEqual([])
  })

  it('ranks labels that start with the query, then label words, then tags', () => {
    expect(found(EN, 'tea')).toEqual(['🍵', '🫖', '🧋', '☕'])
    expect(found(EN, 'TEA ')).toEqual(found(EN, 'tea'))
  })

  it('matches the starts of words, split on spaces and punctuation', () => {
    expect(found(EN, 'handle')).toEqual(['🍵'])
    expect(found(EN, 'rex')).toEqual(['🦖'])
    expect(found(EN, 't-rex')).toEqual(['🦖'])
    expect(found(EN, 'taiwan')).toEqual(['🇹🇼'])
    expect(found(EN, '10')).toEqual(['🔟'])
    // Not inside a word: "cup" is not "teacup".
    expect(found(EN, 'eacup')).toEqual([])
  })

  it('needs every word of the query', () => {
    expect(found(EN, 'tea drink')).toEqual(['🍵', '🫖', '☕'])
    expect(found(EN, 'hot tea')).toEqual(['☕'])
    expect(found(EN, 'teacup with')).toEqual(['🍵'])
    expect(found(EN, 'tea pizza')).toEqual([])
  })

  it('matches Chinese inside labels and tags, and English through the appended tags', () => {
    // 茶壺 starts with the query; the other two have it inside their labels.
    expect(found(ZH, '茶')).toEqual(['🫖', '🧋', '🍵'])
    expect(found(ZH, '熱')).toEqual(['🍵', '☕'])
    expect(found(ZH, '奶茶')).toEqual(['🧋'])
    // Only the tags have English words, so English matches keep the dataset's order.
    expect(found(ZH, 'tea')).toEqual(['🧋', '🍵', '🫖', '☕'])
    expect(found(ZH, '茶 pot')).toEqual(['🫖'])
  })

  it('reads full-width letters as ASCII ones', () => {
    expect(found(EN, 'ｔｅａｐｏｔ')).toEqual(['🫖'])
  })

  it('finds a pasted emoji first, with or without its variation selector', () => {
    expect(found(EN, '🍵')).toEqual(['🍵'])
    expect(found(EN, ' 🫖 ')).toEqual(['🫖'])
    expect(found(EN, '☺')).toEqual(['☺️'])
    expect(found(EN, '☕️')).toEqual(['☕'])
  })

  it('finds nothing that does not match', () => {
    expect(found(EN, 'zebra')).toEqual([])
    expect(found(ZH, '貓')).toEqual([])
  })

  it('never throws, whatever the query', () => {
    for (const query of ['(', '*', '\\', '[a-', '‍', '🏻', 'a'.repeat(500)]) {
      expect(Array.isArray(searchEmoji(EN, query))).toBe(true)
    }
  })
})
