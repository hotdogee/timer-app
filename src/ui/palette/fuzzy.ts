/**
 * Fuzzy matching for the command palette (spec.md › Command palette): the query matches a text
 * when its characters appear in the text in order, ignoring case (a subsequence match). Matches
 * are scored by how tight they are, so ranking puts `stop` → "New **stop**watch" above a match
 * scattered across words.
 *
 * Pure and total: any strings in, a number or `null` out, never a throw.
 */

/** Every matched character. */
const MATCH = 1
/** A matched character that starts a word: the first character, after a separator, or camelCase. */
const WORD_START = 0.8
/** A matched character right after the previous match. */
const CONSECUTIVE = 1
/** The first query character matched at the very start of the text. */
const PREFIX = 0.5
/** Each break between two matched characters. */
const GAP_OPEN = 0.5
/** Each text character skipped between two matched characters. */
const GAP_CHAR = 0.05
/** Each text character before the first match. */
const LEADING_CHAR = 0.03
/** Each text character after the last match, so shorter texts win ties. */
const TRAILING_CHAR = 0.01

const WORD_CHAR = /[\p{L}\p{N}]/u
const LOWER = /\p{Ll}/u
const UPPER = /\p{Lu}/u
const WHITESPACE = /\s/u

/** Whether the character at `i` starts a word in `chars`. */
function startsWord(chars: readonly string[], i: number): boolean {
  const current = chars[i] ?? ''
  const previous = chars[i - 1]
  if (previous === undefined) return true
  if (!WORD_CHAR.test(previous)) return WORD_CHAR.test(current)
  return LOWER.test(previous) && UPPER.test(current)
}

/**
 * Scores how well `query` matches `text`, or returns `null` when it does not match. Higher is
 * better. Matching ignores case and every whitespace character in the query, compares code points
 * (an emoji counts as one character), and takes the best of all possible alignments rather than
 * the first one found, so `stop` scores its contiguous match in "Start stopwatch". Contiguous
 * runs, word starts and an early first match score higher; skipped characters and a longer text
 * score lower. An empty query (or one of only whitespace) matches every text with score 0.
 */
export function score(query: string, text: string): number | null {
  if (typeof query !== 'string' || typeof text !== 'string') return null
  const needle = Array.from(query)
    .filter((ch) => !WHITESPACE.test(ch))
    .map((ch) => ch.toLowerCase())
  if (needle.length === 0) return 0
  const original = Array.from(text)
  const hay = original.map((ch) => ch.toLowerCase())
  const n = hay.length
  if (needle.length > n) return null

  // best[j]: the best score of the query so far with its last character matched at text index j.
  let best = new Float64Array(n).fill(-Infinity)
  const first = needle[0]
  for (let j = 0; j < n; j++) {
    if (hay[j] !== first) continue
    best[j] =
      MATCH + (startsWord(original, j) ? WORD_START : 0) + (j === 0 ? PREFIX : -LEADING_CHAR * j)
  }
  for (let i = 1; i < needle.length; i++) {
    const next = new Float64Array(n).fill(-Infinity)
    const ch = needle[i]
    // The best predecessor k ≤ j - 2 (a gap) with its linear gap cost folded in:
    // best[k] - GAP_CHAR * (j - k - 1) = (best[k] + GAP_CHAR * (k + 1)) - GAP_CHAR * j.
    let gapBest = -Infinity
    for (let j = i; j < n; j++) {
      const k = j - 2
      const candidate = k >= 0 ? (best[k] ?? -Infinity) + GAP_CHAR * (k + 1) : -Infinity
      if (candidate > gapBest) gapBest = candidate
      if (hay[j] !== ch) continue
      const consecutive = (best[j - 1] ?? -Infinity) + CONSECUTIVE
      const gapped = gapBest - GAP_OPEN - GAP_CHAR * j
      const previous = Math.max(consecutive, gapped)
      if (previous === -Infinity) continue
      next[j] = previous + MATCH + (startsWord(original, j) ? WORD_START : 0)
    }
    best = next
  }
  let result = -Infinity
  for (let j = 0; j < n; j++) {
    const total = (best[j] ?? -Infinity) - TRAILING_CHAR * (n - 1 - j)
    if (total > result) result = total
  }
  return result === -Infinity ? null : result
}

/**
 * The items whose text matches `query`, best first; items that score the same keep their order
 * (command order breaks ties). With an empty query every item comes back in order.
 */
export function rank<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  const scored: { item: T; score: number; index: number }[] = []
  items.forEach((item, index) => {
    const s = score(query, text(item))
    if (s !== null) scored.push({ item, score: s, index })
  })
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.map((entry) => entry.item)
}
