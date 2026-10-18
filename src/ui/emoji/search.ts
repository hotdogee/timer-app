/**
 * The emoji picker's search: which emoji a query finds, best first. Pure and total.
 *
 * The query is trimmed, lower-cased and split on whitespace, and every word of it must match. A
 * word matches an emoji when a word of its label or tags starts with it ("tea" finds "teacup"),
 * words being split on spaces and the punctuation emoji names use (`:`, `-`, `_`, `&`,
 * parentheses). Chinese and Japanese write no spaces between words, so a query word with a
 * non-ASCII character also matches anywhere inside the label or tags ("茶" finds "熱茶"). Pasting
 * an emoji finds that emoji, with or without its variation selector. Full-width letters
 * and digits count as their ASCII forms (NFKC), as a Japanese keyboard may type them.
 *
 * Order: the pasted emoji, then labels that start with the whole query, then labels that match
 * every word, then the rest (matched through the tags); within each, the dataset's order.
 */
import type { EmojiEntry } from './data'

/** Where emoji names break into words. */
const WORD_BREAK = /[\s:\-_&()]+/u
const NON_ASCII = /\P{ASCII}/u
/** Variation selector 16 (emoji presentation), which pasted text may have or lack. */
const VS16 = /\uFE0F/gu

/** An entry's searchable text, lower-cased and split once. */
interface Prepared {
  readonly bare: string
  readonly label: string
  readonly tags: string
  readonly labelWords: readonly string[]
  readonly tagWords: readonly string[]
}

const prepared = new WeakMap<EmojiEntry, Prepared>()

function prepare(entry: EmojiEntry): Prepared {
  let ready = prepared.get(entry)
  if (ready === undefined) {
    const label = entry[1].toLowerCase()
    const tags = entry[2].toLowerCase()
    ready = {
      bare: entry[0].replace(VS16, ''),
      label,
      tags,
      labelWords: label.split(WORD_BREAK).filter((word) => word !== ''),
      tagWords: tags.split(WORD_BREAK).filter((word) => word !== ''),
    }
    prepared.set(entry, ready)
  }
  return ready
}

/** Whether query word `token` matches `text`, whose words are `words` (see the module notes). */
function matches(token: string, words: readonly string[], text: string): boolean {
  return (
    words.some((word) => word.startsWith(token)) || (NON_ASCII.test(token) && text.includes(token))
  )
}

/** The rank of an entry for the query (0 best), or -1 when it does not match. */
function rankOf(
  entry: EmojiEntry,
  tokens: readonly string[],
  phrase: string,
  pasted: string,
): number {
  const text = prepare(entry)
  if (text.bare === pasted) return 0
  if (text.label.startsWith(phrase)) return 1
  let inLabel = true
  for (const token of tokens) {
    if (matches(token, text.labelWords, text.label)) continue
    if (!matches(token, text.tagWords, text.tags)) return -1
    inLabel = false
  }
  return inLabel ? 2 : 3
}

/**
 * The entries `query` finds, best first (see the module notes). A blank query finds nothing: the
 * picker shows the groups instead.
 */
export function searchEmoji(entries: readonly EmojiEntry[], query: string): EmojiEntry[] {
  const normalized = typeof query === 'string' ? query.normalize('NFKC').trim().toLowerCase() : ''
  if (normalized === '') return []
  const tokens = normalized.split(/\s+/u)
  const phrase = tokens.join(' ')
  const pasted = query.trim().replace(VS16, '')
  const ranked: EmojiEntry[][] = [[], [], [], []]
  for (const entry of entries) {
    const rank = rankOf(entry, tokens, phrase, pasted)
    if (rank >= 0) ranked[rank]?.push(entry)
  }
  return ranked.flat()
}
