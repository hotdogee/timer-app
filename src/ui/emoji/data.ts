/**
 * The emoji picker's data: its shape, which scripts/emoji-data.mjs builds from emojibase-data and
 * the `emojiData` plugin in vite.config.ts serves as `virtual:emoji-data/<locale>`, and the
 * loader the picker gets it through.
 *
 * Each app language's data is a chunk of its own, loaded with `import()` the first time the
 * picker opens in that language: the startup bundle carries none of it, and a language nobody
 * uses is never downloaded. The loader names the three modules in three literal `import()` calls
 * (not one with a template), so the bundler can split them.
 */
import type { Locale } from '../../i18n'

/** An emoji group ("Food & drink"), in emojibase's order. */
export interface EmojiGroup {
  /** emojibase's key, such as `food-drink`. */
  readonly key: string
  /** Its name in the dataset's language. */
  readonly label: string
}

/**
 * An emoji: its text, its name, its tags joined by spaces (`''` when none; in Chinese and Japanese
 * also the English name and tags), the index of its group in `groups`, and the Unicode emoji
 * version that added it (0.6 … 18). Tuples keep the chunk small: about 1,900 of them.
 */
export type EmojiEntry = readonly [
  emoji: string,
  label: string,
  tags: string,
  group: number,
  version: number,
]

/**
 * An emoji drawn once to learn whether the system's emoji font has its version
 * (`unsupportedVersions` in support.ts): a single code point, or for a version of sequences only,
 * a ZWJ sequence and its first code point as `base`.
 */
export interface EmojiProbe {
  readonly version: number
  readonly emoji: string
  readonly base?: string
}

/** The picker's data in one language. */
export interface EmojiDataset {
  readonly groups: readonly EmojiGroup[]
  /** Base emoji only (no skin tones), in Unicode's emoji order. */
  readonly emoji: readonly EmojiEntry[]
  /** One per emoji version from 11 on, in version order. */
  readonly probes: readonly EmojiProbe[]
}

/** Imports one language's data module. */
export type DatasetImporter = (locale: Locale) => Promise<{ readonly default: EmojiDataset }>

/** The data module of `locale`: one literal `import()` per language, so each is a chunk. */
function importDataset(locale: Locale): Promise<{ readonly default: EmojiDataset }> {
  switch (locale) {
    case 'en':
      return import('virtual:emoji-data/en')
    case 'zh-TW':
      return import('virtual:emoji-data/zh-TW')
    case 'ja':
      return import('virtual:emoji-data/ja')
  }
}

/**
 * A loader of each language's data through `importer`, keeping one promise per language, so the
 * picker opening again (or in another card) does not import again. A failed import is forgotten,
 * so the next call (the picker's Retry) tries again.
 */
export function createDatasetLoader(
  importer: DatasetImporter,
): (locale: Locale) => Promise<EmojiDataset> {
  const loads = new Map<Locale, Promise<EmojiDataset>>()
  return (locale) => {
    const cached = loads.get(locale)
    if (cached !== undefined) return cached
    const load = importer(locale).then((module) => module.default)
    loads.set(locale, load)
    load.catch(() => {
      if (loads.get(locale) === load) loads.delete(locale)
    })
    return load
  }
}

/** The picker's data in `locale`, loaded on first use (see the module notes). */
export const loadEmojiDataset: (locale: Locale) => Promise<EmojiDataset> =
  createDatasetLoader(importDataset)
