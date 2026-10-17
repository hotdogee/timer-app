import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { rank, score } from './fuzzy'

/** Whether `query` (whitespace removed, lowercased) is a subsequence of lowercased `text`. */
function isSubsequence(query: string, text: string): boolean {
  const needle = Array.from(query)
    .filter((ch) => !/\s/u.test(ch))
    .map((ch) => ch.toLowerCase())
  const hay = Array.from(text).map((ch) => ch.toLowerCase())
  let i = 0
  for (const ch of hay) if (ch === needle[i]) i++
  return i === needle.length
}

/** Asserts that `query` scores higher against `better` than against `worse`. */
function expectBetter(query: string, better: string, worse: string): void {
  const a = score(query, better)
  const b = score(query, worse)
  expect(a, `${query} → ${better}`).not.toBeNull()
  expect(b, `${query} → ${worse}`).not.toBeNull()
  expect(a ?? 0).toBeGreaterThan(b ?? 0)
}

describe('score', () => {
  it('matches every text, with score 0, for an empty or blank query', () => {
    expect(score('', 'New timer')).toBe(0)
    expect(score('', '')).toBe(0)
    expect(score('  \t', 'Reset')).toBe(0)
  })

  it('returns null when the query is not a subsequence of the text', () => {
    expect(score('xyz', 'New timer')).toBeNull()
    expect(score('tn', 'New timer')).toBeNull()
    expect(score('nt', 'New timer')).not.toBeNull()
    expect(score('rt', 'tr')).toBeNull()
    expect(score('abc', '')).toBeNull()
  })

  it('returns null when the query is longer than the text', () => {
    expect(score('timers', 'timer')).toBeNull()
  })

  it('ignores case on both sides', () => {
    expect(score('NEW', 'new stopwatch')).toBe(score('new', 'New Stopwatch'))
    expect(score('sToP', 'New stopwatch')).not.toBeNull()
  })

  it('ignores whitespace in the query', () => {
    expect(score('new st', 'New stopwatch')).toBe(score('newst', 'New stopwatch'))
    expect(score(' pause ', 'Pause')).toBe(score('pause', 'Pause'))
  })

  it('counts an astral character as one character', () => {
    expect(score('😀', 'a😀')).not.toBeNull()
    expect(score('a😀b', 'a😀b')).not.toBeNull()
    expect(score('😀😀', '😀')).toBeNull()
  })

  it('ranks a contiguous match above a scattered one', () => {
    expectBetter('abc', 'abcxx', 'axbxc')
    expectBetter('stop', 'New stopwatch', 'Set top pause')
  })

  it('ranks a match at a word start above one inside a word', () => {
    expectBetter('ta', 'x tab', 'xstab')
    expectBetter('w', 'new watch', 'newxwatch')
  })

  it('counts camelCase boundaries as word starts', () => {
    expectBetter('sw', 'xxStopWatch', 'xxstopwatch')
  })

  it('ranks an earlier match above a later one', () => {
    expectBetter('a', 'abcd', 'bcda')
    expectBetter('re', 'Reset xx', 'xx Reset')
  })

  it('ranks the exact text above a longer one with the same match', () => {
    expectBetter('reset', 'Reset', 'Reset stopwatch')
  })

  it('finds the best alignment, not the first one', () => {
    // A greedy match takes the S and t of "Start"; the best one is "stop" in "stopwatch".
    expect(score('stop', 'Start stopwatch')).toBe(score('stop', 'Xxxxx stopwatch'))
  })

  it('ranks "New stopwatch" first for "stop" among the palette titles', () => {
    const titles = ['New timer', 'New stopwatch', 'Start', 'Reset', 'Pause', 'Keyboard shortcuts']
    expect(rank(titles, 'stop', (t) => t)[0]).toBe('New stopwatch')
  })

  it('matches exactly when the query is a subsequence (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), fc.string({ maxLength: 16 }), (query, text) => {
        expect(score(query, text) !== null).toBe(isSubsequence(query, text))
      }),
    )
  })

  it('always matches a text against itself and its own prefixes (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 16 }), fc.nat(16), (text, cut) => {
        const prefix = Array.from(text).slice(0, cut).join('')
        expect(score(text, text)).not.toBeNull()
        expect(score(prefix, text)).not.toBeNull()
      }),
    )
  })

  it('returns a finite number for every match (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 6 }), fc.string({ maxLength: 40 }), (query, text) => {
        const s = score(query, text)
        if (s !== null) expect(Number.isFinite(s)).toBe(true)
      }),
    )
  })

  it('returns null for non-string input from untyped code', () => {
    expect(score(undefined as unknown as string, 'a')).toBeNull()
    expect(score('a', null as unknown as string)).toBeNull()
  })
})

describe('rank', () => {
  const items = ['Reset', 'New timer', 'New stopwatch', 'Rename', 'Restart']

  it('keeps every item in order for an empty query', () => {
    expect(rank(items, '', (t) => t)).toEqual(items)
  })

  it('drops items that do not match', () => {
    expect(rank(items, 'zz', (t) => t)).toEqual([])
    expect(rank(items, 'tim', (t) => t)).toEqual(['New timer'])
  })

  it('sorts by score, best first', () => {
    const ranked = rank(items, 'res', (t) => t)
    expect(ranked).toEqual(['Reset', 'Restart'])
  })

  it('keeps the original order for equal scores', () => {
    const same = [
      { id: 1, t: 'Mute' },
      { id: 2, t: 'Mute' },
      { id: 3, t: 'Mute' },
    ]
    expect(rank(same, 'mu', (x) => x.t).map((x) => x.id)).toEqual([1, 2, 3])
  })

  it('does not change the input array', () => {
    const copy = [...items]
    rank(items, 're', (t) => t)
    expect(items).toEqual(copy)
  })
})
