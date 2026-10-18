/**
 * The emoji picker's data (src/ui/emoji/), made from emojibase-data at build time. The
 * `emojiData` plugin in vite.config.ts serves `virtual:emoji-data/<locale>` from
 * {@link emojiDataset}: one chunk per app language, which the app loads the first time the
 * picker opens, so nothing of emojibase-data's few megabytes of JSON ships otherwise.
 *
 * The dataset keeps only what the picker shows and searches, as compact tuples: base emoji
 * (people choose a card icon, not a skin tone, so `skins` are not expanded), without the
 * component group (skin tones and hair styles on their own) and the lone regional indicators,
 * which emojibase lists without a group. In Chinese and Japanese the tags carry the English
 * label and tags as well, so a search finds an emoji in either language. Each Unicode emoji
 * version from 11 on also gets a probe, an emoji of that version the app draws once to learn
 * whether the system's emoji font has it (src/ui/emoji/support.ts); older emoji draw everywhere
 * the app runs.
 */
import { createRequire } from 'node:module'

/** Loads a JSON file of a dependency (emojibase-data has no `exports` map, so any file resolves). */
const load = createRequire(import.meta.url)

/**
 * @typedef {'en' | 'zh-TW' | 'ja'} EmojiLocale
 * An app language (src/i18n).
 */

/**
 * @typedef {object} SourceEmoji
 * An entry of emojibase-data's `data.json`, as far as it is read here.
 * @property {string} label
 * @property {string} emoji
 * @property {string[]} [tags]
 * @property {number} [group] The group's `order` in `messages.json`; absent for regional indicators.
 * @property {number} [order] Its place in Unicode's emoji order.
 * @property {number} version The Unicode emoji version that added it (0.6, 1, … 12.1, …).
 */

/**
 * @typedef {object} SourceMessages
 * emojibase-data's `messages.json`, as far as it is read here.
 * @property {{ key: string, message: string, order: number }[]} groups
 */

/**
 * @typedef {object} EmojiGroup
 * @property {string} key emojibase's key, such as `food-drink`.
 * @property {string} label Its name in the language, first letter upper-cased ("Food & drink").
 */

/**
 * @typedef {[emoji: string, label: string, tags: string, group: number, version: number]} EmojiEntry
 * An emoji: its text, its name, its tags joined by spaces (`''` when none), the index of its
 * group in `groups`, and the Unicode emoji version that added it.
 */

/**
 * @typedef {object} EmojiProbe
 * @property {number} version
 * @property {string} emoji A single code point; for a version of sequences only, a ZWJ sequence.
 * @property {string} [base] A ZWJ probe's first code point: a system without the sequence draws
 *   the sequence's parts apart, wider than this.
 */

/**
 * @typedef {object} EmojiDataset
 * The picker's data in one language; the same shape as `EmojiDataset` in src/ui/emoji/data.ts.
 * @property {EmojiGroup[]} groups In emojibase's order.
 * @property {EmojiEntry[]} emoji In Unicode's emoji order.
 * @property {EmojiProbe[]} probes One per emoji version from 11 on, in version order.
 */

/** The app languages the picker has data for, as `src/i18n` names them. */
export const EMOJI_LOCALES = /** @type {readonly EmojiLocale[]} */ (
  Object.freeze(['en', 'zh-TW', 'ja'])
)

/** The emojibase-data folder of each app language. */
const SOURCE_FOLDERS = /** @type {const} */ ({ en: 'en', 'zh-TW': 'zh-hant', ja: 'ja' })

/** emojibase's group of components (skin tones, hair styles), which are not emoji on their own. */
const COMPONENT_GROUP = 2

/** The first emoji version that gets a probe: Emoji 11 (2018) and older draw on every system. */
const FIRST_PROBED_VERSION = 11

const ZWJ = '‍'

/** @type {Map<EmojiLocale, EmojiDataset>} */
const datasets = new Map()

/**
 * emojibase-data's emoji and messages in folder `folder`.
 * @param {string} folder
 * @returns {{ data: SourceEmoji[], messages: SourceMessages }}
 */
function readSource(folder) {
  return {
    data: /** @type {SourceEmoji[]} */ (load(`emojibase-data/${folder}/data.json`)),
    messages: /** @type {SourceMessages} */ (load(`emojibase-data/${folder}/messages.json`)),
  }
}

/**
 * `text` with its first letter upper-cased ("smileys & emotion" → "Smileys & emotion"); a
 * script without case keeps it as it is.
 * @param {string} text
 */
function capitalize(text) {
  const [first = '', ...rest] = text
  return first.toUpperCase() + rest.join('')
}

/**
 * Whether `entry` is an emoji the picker offers: in a group other than the components.
 * @param {SourceEmoji} entry
 * @returns {entry is SourceEmoji & { group: number, order: number }}
 */
function isPickable(entry) {
  return entry.group !== undefined && entry.group !== COMPONENT_GROUP && entry.order !== undefined
}

/**
 * The probe of each emoji version from {@link FIRST_PROBED_VERSION} on: its first emoji that is
 * a single code point (so no ZWJ sequence, no VS16 and no flag), or, for a version made only of
 * sequences (12.1, 13.1, 15.1), its first ZWJ sequence with that sequence's first code point as
 * `base`. A version with neither gets no probe.
 * @param {readonly EmojiEntry[]} emoji In emoji order.
 * @returns {EmojiProbe[]}
 */
function probesOf(emoji) {
  /** @type {Map<number, EmojiEntry[]>} */
  const byVersion = new Map()
  for (const entry of emoji) {
    const version = entry[4]
    if (version < FIRST_PROBED_VERSION) continue
    const list = byVersion.get(version)
    if (list === undefined) byVersion.set(version, [entry])
    else list.push(entry)
  }
  /** @type {EmojiProbe[]} */
  const probes = []
  for (const [version, entries] of [...byVersion].sort(([a], [b]) => a - b)) {
    const single = entries.find(([text]) => [...text].length === 1)
    if (single !== undefined) {
      probes.push({ version, emoji: single[0] })
      continue
    }
    const sequence = entries.find(([text]) => text.includes(ZWJ))
    const first = sequence?.[0].codePointAt(0)
    if (sequence !== undefined && first !== undefined) {
      probes.push({ version, emoji: sequence[0], base: String.fromCodePoint(first) })
    }
  }
  return probes
}

/**
 * The picker's data in app language `locale` (see the module notes), read from emojibase-data
 * once per language.
 * @param {EmojiLocale} locale
 * @returns {EmojiDataset}
 */
export function emojiDataset(locale) {
  const cached = datasets.get(locale)
  if (cached !== undefined) return cached
  if (!EMOJI_LOCALES.includes(locale)) {
    throw new Error(`No emoji data for "${String(locale)}"; known: ${EMOJI_LOCALES.join(', ')}`)
  }
  const { data, messages } = readSource(SOURCE_FOLDERS[locale])
  // English names and tags, appended to the tags of other languages (looked up by emoji).
  /** @type {Map<string, string[]> | null} */
  const english =
    locale === 'en'
      ? null
      : new Map(
          readSource('en').data.map((entry) => [entry.emoji, [entry.label, ...(entry.tags ?? [])]]),
        )

  const sourceGroups = messages.groups
    .filter((group) => group.order !== COMPONENT_GROUP)
    .sort((a, b) => a.order - b.order)
  const groupIndex = new Map(sourceGroups.map((group, index) => [group.order, index]))
  const groups = sourceGroups.map((group) => ({ key: group.key, label: capitalize(group.message) }))

  /** @type {EmojiEntry[]} */
  const emoji = []
  for (const entry of data.filter(isPickable).sort((a, b) => a.order - b.order)) {
    const group = groupIndex.get(entry.group)
    if (group === undefined) continue
    const words = [...(entry.tags ?? []), ...(english?.get(entry.emoji) ?? [])]
    emoji.push([entry.emoji, entry.label, [...new Set(words)].join(' '), group, entry.version])
  }

  const dataset = { groups, emoji, probes: probesOf(emoji) }
  datasets.set(locale, dataset)
  return dataset
}
