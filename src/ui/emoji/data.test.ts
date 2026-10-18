import { describe, expect, it, vi } from 'vitest'

import type { Locale } from '../../i18n'
import { createDatasetLoader, loadEmojiDataset, type EmojiDataset } from './data'

const DATASET: EmojiDataset = { groups: [], emoji: [], probes: [] }

describe('createDatasetLoader', () => {
  it('imports each language once and shares the promise', async () => {
    const importer = vi.fn((locale: Locale) =>
      Promise.resolve({ default: { ...DATASET, groups: [{ key: locale, label: locale }] } }),
    )
    const load = createDatasetLoader(importer)
    const first = load('ja')
    expect(load('ja')).toBe(first)
    expect((await first).groups[0]?.key).toBe('ja')
    expect((await load('en')).groups[0]?.key).toBe('en')
    expect(importer.mock.calls.map(([locale]) => locale)).toEqual(['ja', 'en'])
  })

  it('forgets a failed import, so the next call tries again', async () => {
    const importer = vi
      .fn<(locale: Locale) => Promise<{ default: EmojiDataset }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ default: DATASET })
    const load = createDatasetLoader(importer)
    await expect(load('zh-TW')).rejects.toThrow('offline')
    await expect(load('zh-TW')).resolves.toBe(DATASET)
    expect(importer).toHaveBeenCalledTimes(2)
  })
})

describe('loadEmojiDataset', () => {
  it('loads the built data of each app language', async () => {
    const en = await loadEmojiDataset('en')
    expect(en.groups.map(({ key }) => key)).toContain('food-drink')
    expect(en.emoji.find(([emoji]) => emoji === '🍵')?.[1]).toBe('teacup without handle')
    const zh = await loadEmojiDataset('zh-TW')
    expect(zh.emoji.find(([emoji]) => emoji === '🍵')?.[1]).toBe('熱茶')
    const ja = await loadEmojiDataset('ja')
    expect(ja.emoji.find(([emoji]) => emoji === '🍵')?.[1]).toBe('湯飲み')
    expect(await loadEmojiDataset('en')).toBe(en)
  })
})
