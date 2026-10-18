import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  addCard,
  anyNeedsFrames,
  applyTyped,
  createStopwatchCard,
  createTimerCard,
  DEFAULT_NAMES,
  DEFAULT_TIMER_DURATION,
  EMPTY_LIST,
  findCard,
  isCardIcon,
  MAX_ICON_LENGTH,
  moveCard,
  moveNeighbor,
  neighborIndex,
  nextDeadline,
  nextDefaultName,
  normalizeList,
  removeCard,
  renameCard,
  restoreCard,
  selectCard,
  selectedCard,
  selectNeighbor,
  setIcon,
  setMuted,
  settleAll,
  updateStopwatch,
  updateTimer,
  type Card,
  type CardId,
  type CardList,
  type Direction,
  type StopwatchCard,
  type TimerCard,
  uniqueName,
} from './card'
import * as stopwatch from './stopwatch'
import * as timer from './timer'
import type { StopwatchState, TimerState } from './types'

const SECOND = 1000
const MINUTE = 60 * SECOND

/** 14:47 UTC on 2026-10-17. Every example happens around this instant. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

/** Freezes `value` and everything it holds, so an operation that mutates its input throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}

/** An idle 5:00 timer card named after its id unless a name is given. */
function tc(id: CardId, name: string = id, state?: TimerState): TimerCard {
  const card = createTimerCard(id, name, NOW)
  return state === undefined ? card : { ...card, timer: state }
}

/** An idle stopwatch card named after its id unless a name is given. */
function sc(id: CardId, name: string = id, state?: StopwatchState): StopwatchCard {
  const card = createStopwatchCard(id, name, NOW)
  return state === undefined ? card : { ...card, stopwatch: state }
}

/** A frozen list of `cards`; the last card is selected unless `selectedId` says otherwise. */
function listOf(cards: Card[], selectedId: CardId | null = cards.at(-1)?.id ?? null): CardList {
  return deepFreeze({ cards, selectedId })
}

/** A frozen list of timers with ids 'c0', 'c1', …; `selected` is an index (default 0). */
function grid(count: number, selected = 0): CardList {
  const cards = Array.from({ length: count }, (_, i) => tc(`c${i}`))
  return listOf(cards, cards[selected]?.id ?? null)
}

const ids = (list: CardList): CardId[] => list.cards.map((card) => card.id)
const names = (list: CardList): string[] => list.cards.map((card) => card.name)

const running = (endsAt: number, duration = 5 * MINUTE): TimerState => ({
  phase: 'running',
  duration,
  endsAt,
})

describe('constants', () => {
  it('starts from a frozen empty list with nothing selected', () => {
    expect(EMPTY_LIST).toEqual({ cards: [], selectedId: null })
    expect(Object.isFrozen(EMPTY_LIST)).toBe(true)
    expect(Object.isFrozen(EMPTY_LIST.cards)).toBe(true)
  })

  it('makes new timers 5 minutes long', () => {
    expect(DEFAULT_TIMER_DURATION).toBe(5 * MINUTE)
  })

  it('names cards "Timer" and "Stopwatch" by default', () => {
    expect(DEFAULT_NAMES).toEqual({ timer: 'Timer', stopwatch: 'Stopwatch' })
  })
})

describe('createTimerCard', () => {
  it('creates an unmuted idle timer set to 5:00 by default', () => {
    expect(createTimerCard('a', 'Timer', NOW)).toEqual({
      id: 'a',
      kind: 'timer',
      name: 'Timer',
      createdAt: NOW,
      muted: false,
      timer: { phase: 'idle', duration: 5 * MINUTE },
    })
  })

  it('uses the given duration, clamping invalid ones to 0 like the timer engine', () => {
    expect(createTimerCard('a', 'Tea', NOW, 3 * MINUTE).timer).toEqual(
      timer.createTimer(3 * MINUTE),
    )
    expect(createTimerCard('a', 'x', NOW, Number.NaN).timer).toEqual({ phase: 'idle', duration: 0 })
    expect(createTimerCard('a', 'x', NOW, -SECOND).timer).toEqual({ phase: 'idle', duration: 0 })
  })

  it('trims the name and falls back to "Timer" when it is blank', () => {
    expect(createTimerCard('a', '  Tea  ', NOW).name).toBe('Tea')
    expect(createTimerCard('a', '', NOW).name).toBe('Timer')
    expect(createTimerCard('a', ' \t\n', NOW).name).toBe('Timer')
  })

  it('stores a non-finite creation time as 0, so the card stays JSON-safe', () => {
    expect(createTimerCard('a', 'x', Number.NaN).createdAt).toBe(0)
    expect(createTimerCard('a', 'x', Number.POSITIVE_INFINITY).createdAt).toBe(0)
  })
})

describe('createStopwatchCard', () => {
  it('creates an unmuted idle stopwatch', () => {
    expect(createStopwatchCard('s', 'Stopwatch', NOW)).toEqual({
      id: 's',
      kind: 'stopwatch',
      name: 'Stopwatch',
      createdAt: NOW,
      muted: false,
      stopwatch: { phase: 'idle' },
    })
  })

  it('trims the name, falls back to "Stopwatch", and stores a non-finite time as 0', () => {
    expect(createStopwatchCard('s', ' Laps ', NOW).name).toBe('Laps')
    expect(createStopwatchCard('s', '   ', NOW).name).toBe('Stopwatch')
    expect(createStopwatchCard('s', 'x', Number.NEGATIVE_INFINITY).createdAt).toBe(0)
  })
})

describe('nextDefaultName', () => {
  it('names the first card of each kind after its kind', () => {
    expect(nextDefaultName(EMPTY_LIST, 'timer')).toBe('Timer')
    expect(nextDefaultName(EMPTY_LIST, 'stopwatch')).toBe('Stopwatch')
  })

  it('numbers further cards from 2', () => {
    expect(nextDefaultName(listOf([tc('a', 'Timer')]), 'timer')).toBe('Timer 2')
    expect(nextDefaultName(listOf([tc('a', 'Timer'), tc('b', 'Timer 2')]), 'timer')).toBe('Timer 3')
    expect(nextDefaultName(listOf([sc('a', 'Stopwatch')]), 'stopwatch')).toBe('Stopwatch 2')
  })

  it('reuses the smallest free number', () => {
    expect(nextDefaultName(listOf([tc('a', 'Timer'), tc('c', 'Timer 3')]), 'timer')).toBe('Timer 2')
    expect(nextDefaultName(listOf([tc('b', 'Timer 2'), tc('c', 'Timer 3')]), 'timer')).toBe('Timer')
  })

  it('does not count cards the user renamed', () => {
    expect(nextDefaultName(listOf([tc('a', 'Timer'), tc('b', 'Tea')]), 'timer')).toBe('Timer 2')
    expect(nextDefaultName(listOf([tc('a', 'Tea'), tc('b', 'Eggs')]), 'timer')).toBe('Timer')
  })

  it('numbers each kind on its own', () => {
    const list = listOf([tc('a', 'Timer'), tc('b', 'Timer 2')])
    expect(nextDefaultName(list, 'stopwatch')).toBe('Stopwatch')
  })

  it('never repeats a name already in the list, whatever card has it', () => {
    expect(nextDefaultName(listOf([sc('a', 'Timer')]), 'timer')).toBe('Timer 2')
    expect(nextDefaultName(listOf([tc('a', 'timer'), tc('b', 'TIMER 2')]), 'timer')).toBe('Timer 3')
  })

  it('does not treat other spellings of a number as taken', () => {
    expect(nextDefaultName(listOf([tc('a', 'Timer'), tc('b', 'Timer 02')]), 'timer')).toBe(
      'Timer 2',
    )
    expect(nextDefaultName(listOf([tc('a', 'Timer 1')]), 'timer')).toBe('Timer')
  })

  it('numbers a preset name the same way, and falls back to the default for a blank one', () => {
    expect(nextDefaultName(EMPTY_LIST, 'timer', 'Tea')).toBe('Tea')
    expect(nextDefaultName(listOf([tc('a', 'Tea')]), 'timer', ' Tea ')).toBe('Tea 2')
    expect(nextDefaultName(listOf([tc('a', 'Timer')]), 'timer', '  ')).toBe('Timer 2')
  })

  it('finds the next number past a long run', () => {
    const cards = Array.from({ length: 50 }, (_, i) =>
      tc(`c${i}`, i === 0 ? 'Timer' : `Timer ${i + 1}`),
    )
    expect(nextDefaultName(listOf(cards), 'timer')).toBe('Timer 51')
  })
})

describe('addCard', () => {
  it('adds the first card and selects it', () => {
    const next = addCard(EMPTY_LIST, tc('a'))
    expect(ids(next)).toEqual(['a'])
    expect(next.selectedId).toBe('a')
  })

  it('appends and selects the new card', () => {
    expect(addCard(listOf([tc('a')]), tc('b'))).toEqual({
      cards: [tc('a'), tc('b')],
      selectedId: 'b',
    })
    const many = addCard(grid(3), sc('s'))
    expect(ids(many)).toEqual(['c0', 'c1', 'c2', 's'])
    expect(many.selectedId).toBe('s')
  })

  it('inserts at an index, clamped into the list', () => {
    const list = grid(3)
    expect(ids(addCard(list, tc('x'), 0))).toEqual(['x', 'c0', 'c1', 'c2'])
    expect(ids(addCard(list, tc('x'), 2))).toEqual(['c0', 'c1', 'x', 'c2'])
    expect(ids(addCard(list, tc('x'), 3))).toEqual(['c0', 'c1', 'c2', 'x'])
    expect(ids(addCard(list, tc('x'), 99))).toEqual(['c0', 'c1', 'c2', 'x'])
    expect(ids(addCard(list, tc('x'), -5))).toEqual(['x', 'c0', 'c1', 'c2'])
    expect(ids(addCard(list, tc('x'), 1.9))).toEqual(['c0', 'x', 'c1', 'c2'])
    expect(ids(addCard(list, tc('x'), Number.NaN))).toEqual(['c0', 'c1', 'c2', 'x'])
    expect(ids(addCard(list, tc('x'), Number.POSITIVE_INFINITY))).toEqual(['c0', 'c1', 'c2', 'x'])
    expect(ids(addCard(list, tc('x'), Number.NEGATIVE_INFINITY))).toEqual(['x', 'c0', 'c1', 'c2'])
  })

  it('ignores a card whose id is already in the list', () => {
    const list = grid(3)
    expect(addCard(list, tc('c1', 'Other'))).toBe(list)
    expect(addCard(list, sc('c0'), 0)).toBe(list)
  })
})

describe('removeCard', () => {
  it('ignores an unknown id and an empty list', () => {
    const list = grid(3)
    expect(removeCard(list, 'nope')).toBe(list)
    expect(removeCard(EMPTY_LIST, 'nope')).toBe(EMPTY_LIST)
  })

  it('leaves nothing selected when the only card goes', () => {
    expect(removeCard(listOf([tc('a')]), 'a')).toEqual({ cards: [], selectedId: null })
  })

  it('moves the selection to the next card when the selected card goes', () => {
    expect(removeCard(grid(3, 1), 'c1')).toEqual({ cards: [tc('c0'), tc('c2')], selectedId: 'c2' })
    expect(removeCard(grid(3, 0), 'c0').selectedId).toBe('c1')
  })

  it('moves the selection to the previous card when the last card goes', () => {
    expect(removeCard(grid(3, 2), 'c2')).toEqual({ cards: [tc('c0'), tc('c1')], selectedId: 'c1' })
  })

  it('keeps the selection when another card goes', () => {
    expect(removeCard(grid(3, 0), 'c2')).toEqual({ cards: [tc('c0'), tc('c1')], selectedId: 'c0' })
    expect(removeCard(grid(3, 2), 'c0').selectedId).toBe('c2')
  })
})

describe('restoreCard', () => {
  it('puts a removed card back where it was and selects it', () => {
    const list = grid(4, 3)
    const removed = removeCard(list, 'c1')
    const restored = restoreCard(removed, tc('c1'), 1)
    expect(ids(restored)).toEqual(ids(list))
    expect(restored.selectedId).toBe('c1')
  })

  it('restores into an empty list', () => {
    expect(restoreCard(EMPTY_LIST, tc('a'), 3)).toEqual({ cards: [tc('a')], selectedId: 'a' })
  })

  it('lands at the end when the list shrank below the old index, and at the start for a negative one', () => {
    expect(ids(restoreCard(grid(2), tc('x'), 5))).toEqual(['c0', 'c1', 'x'])
    expect(ids(restoreCard(grid(2), tc('x'), -1))).toEqual(['x', 'c0', 'c1'])
  })

  it('ignores a card whose id is back in the list already', () => {
    const list = grid(3)
    expect(restoreCard(list, tc('c2'), 0)).toBe(list)
  })

  it('renumbers a card whose name another card took meanwhile, so no two cards share a name', () => {
    // Timer, Timer 2, Timer 3; Timer 2 is deleted and a new card takes the name "Timer 2".
    const list = listOf([tc('a', 'Timer'), tc('c', 'Timer 3'), tc('n', 'Timer 2')], 'n')
    const restored = restoreCard(list, tc('b', 'Timer 2'), 1)
    expect(names(restored)).toEqual(['Timer', 'Timer 4', 'Timer 3', 'Timer 2'])
    expect(findCard(restored, 'b')?.name).toBe('Timer 4')
    expect(restored.selectedId).toBe('b')
  })

  it('keeps the name and the card object when the name is still free', () => {
    const card = tc('b', 'Tea')
    const restored = restoreCard(grid(2), card, 1)
    expect(restored.cards[1]).toBe(card)
  })
})

describe('uniqueName', () => {
  it('keeps a free name, trimmed', () => {
    expect(uniqueName(grid(2), 'timer', '  Pasta ')).toBe('Pasta')
  })

  it('numbers a taken name from its base, case-insensitively', () => {
    const list = listOf([tc('a', 'Tea'), tc('b', 'tea 2')])
    expect(uniqueName(list, 'timer', 'TEA')).toBe('TEA 3')
    expect(uniqueName(list, 'timer', 'Tea 2')).toBe('Tea 3')
  })

  it('reuses the smallest free number, which may be the bare base', () => {
    expect(uniqueName(listOf([tc('a', 'Timer 2')]), 'timer', 'Timer 2')).toBe('Timer')
  })

  it('falls back to the default name for a blank one', () => {
    expect(uniqueName(EMPTY_LIST, 'stopwatch', '  ')).toBe('Stopwatch')
    expect(uniqueName(listOf([sc('a', 'Stopwatch')]), 'stopwatch', '')).toBe('Stopwatch 2')
  })
})

describe('renameCard', () => {
  it('renames, trimming the new name, and keeps everything else', () => {
    const list = listOf([tc('a'), sc('b')], 'a')
    const next = renameCard(list, 'b', '  Laps  ')
    expect(names(next)).toEqual(['a', 'Laps'])
    expect(next.cards[1]).toEqual({ ...sc('b'), name: 'Laps' })
    expect(next.selectedId).toBe('a')
    expect(next.cards[0]).toBe(list.cards[0])
  })

  it('ignores a blank name, an unknown id and an unchanged name', () => {
    const list = listOf([tc('a', 'Tea')])
    expect(renameCard(list, 'a', '')).toBe(list)
    expect(renameCard(list, 'a', '   ')).toBe(list)
    expect(renameCard(list, 'nope', 'Eggs')).toBe(list)
    expect(renameCard(list, 'a', 'Tea')).toBe(list)
    expect(renameCard(list, 'a', ' Tea ')).toBe(list)
    expect(renameCard(EMPTY_LIST, 'a', 'Tea')).toBe(EMPTY_LIST)
  })
})

describe('moveCard', () => {
  it('moves a card forward and backward, keeping the selection', () => {
    const list = grid(4, 2)
    expect(moveCard(list, 'c0', 2)).toEqual({
      cards: [tc('c1'), tc('c2'), tc('c0'), tc('c3')],
      selectedId: 'c2',
    })
    expect(ids(moveCard(list, 'c3', 0))).toEqual(['c3', 'c0', 'c1', 'c2'])
    expect(ids(moveCard(list, 'c1', 2))).toEqual(['c0', 'c2', 'c1', 'c3'])
  })

  it('clamps the target index into the list', () => {
    const list = grid(3)
    expect(ids(moveCard(list, 'c0', 10))).toEqual(['c1', 'c2', 'c0'])
    expect(ids(moveCard(list, 'c2', -4))).toEqual(['c2', 'c0', 'c1'])
    expect(ids(moveCard(list, 'c0', Number.POSITIVE_INFINITY))).toEqual(['c1', 'c2', 'c0'])
    expect(ids(moveCard(list, 'c2', Number.NEGATIVE_INFINITY))).toEqual(['c2', 'c0', 'c1'])
    expect(ids(moveCard(list, 'c0', 1.7))).toEqual(['c1', 'c0', 'c2'])
  })

  it('returns the list unchanged when nothing moves', () => {
    const list = grid(3)
    expect(moveCard(list, 'c1', 1)).toBe(list)
    expect(moveCard(list, 'c2', 7)).toBe(list)
    expect(moveCard(list, 'c0', -1)).toBe(list)
    expect(moveCard(list, 'c0', Number.NaN)).toBe(list)
    expect(moveCard(list, 'nope', 0)).toBe(list)
    const one = grid(1)
    expect(moveCard(one, 'c0', 3)).toBe(one)
    expect(moveCard(EMPTY_LIST, 'c0', 0)).toBe(EMPTY_LIST)
  })
})

describe('setMuted', () => {
  it('mutes and unmutes one card', () => {
    const list = grid(2)
    const muted = setMuted(list, 'c1', true)
    expect(muted.cards.map((card) => card.muted)).toEqual([false, true])
    expect(muted.cards[0]).toBe(list.cards[0])
    expect(setMuted(muted, 'c1', false)).toEqual(list)
  })

  it('returns the list unchanged for no change or an unknown id', () => {
    const list = grid(2)
    expect(setMuted(list, 'c0', false)).toBe(list)
    expect(setMuted(list, 'nope', true)).toBe(list)
  })
})

describe('isCardIcon', () => {
  it.each([
    ['a single emoji', '🍵'],
    ['a flag', '🇹🇼'],
    ['a keycap', '1️⃣'],
    ['a ZWJ sequence', '👩‍💻'],
    ['a skin-toned emoji', '👋🏽'],
    ['a subdivision flag (tags)', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'],
    ['a text-style pictograph with VS16', '☺️'],
    ['a family', '👨‍👩‍👧‍👦'],
  ])('accepts %s', (_, icon) => {
    expect(isCardIcon(icon)).toBe(true)
  })

  it.each([
    ['an empty string', ''],
    ['blanks', '  '],
    ['text', 'abc'],
    ['text around an emoji', 'a🍵'],
    ['an emoji with a space', '🍵 '],
    ['a bare skin tone', '🏻'],
    ['a bare joiner', '\u200D'],
    ['a bare variation selector', '\uFE0F'],
    ['a digit or # without a keycap', '#'],
    ['a lone surrogate', '\uD83C'],
    ['too many code units', '🍵'.repeat(MAX_ICON_LENGTH / 2 + 1)],
  ])('refuses %s', (_, icon) => {
    expect(isCardIcon(icon)).toBe(false)
  })

  it('refuses what is not a string', () => {
    for (const value of [undefined, null, 1, ['🍵'], { icon: '🍵' }]) {
      expect(isCardIcon(value)).toBe(false)
    }
  })

  it('accepts icons up to the limit', () => {
    expect(isCardIcon('🍵'.repeat(MAX_ICON_LENGTH / 2))).toBe(true)
  })
})

describe('setIcon', () => {
  it('sets, replaces and removes one card’s icon, keeping everything else', () => {
    const list = listOf([tc('a'), sc('b')], 'a')
    const set = setIcon(list, 'b', '🍵')
    expect(set.cards[1]).toEqual({ ...sc('b'), icon: '🍵' })
    expect(set.cards[0]).toBe(list.cards[0])
    expect(set.selectedId).toBe('a')
    const replaced = setIcon(set, 'b', '🏃')
    expect(replaced.cards[1]?.icon).toBe('🏃')
    const removed = setIcon(replaced, 'b', null)
    expect(removed).toEqual(list)
    // Removed, not set to undefined: a stored or synced card never carries an empty key.
    expect(Object.hasOwn(removed.cards[1] ?? {}, 'icon')).toBe(false)
  })

  it('returns the list unchanged for an unknown id, an invalid icon or no change', () => {
    const list = listOf([tc('a'), { ...tc('b'), icon: '🍵' }])
    expect(setIcon(list, 'nope', '🍵')).toBe(list)
    expect(setIcon(list, 'a', 'abc')).toBe(list)
    expect(setIcon(list, 'a', '')).toBe(list)
    expect(setIcon(list, 'b', '🍵')).toBe(list)
    expect(setIcon(list, 'a', null)).toBe(list)
    expect(setIcon(EMPTY_LIST, 'a', '🍵')).toBe(EMPTY_LIST)
  })

  it('round-trips every card through an icon and its removal (property)', () => {
    const icon = fc.constantFrom('🍵', '🇹🇼', '1️⃣', '👩‍💻', '🏴󠁧󠁢󠁥󠁮󠁧󠁿')
    const card = fc.oneof(
      fc
        .record({ id: fc.string({ minLength: 1 }), name: fc.string() })
        .map(({ id, name }) => tc(id, name)),
      fc
        .record({ id: fc.string({ minLength: 1 }), name: fc.string() })
        .map(({ id, name }) => sc(id, name)),
    )
    fc.assert(
      fc.property(card, icon, (c, emoji) => {
        const list = listOf([c])
        const set = setIcon(list, c.id, emoji)
        expect(set.cards[0]).toEqual({ ...c, icon: emoji })
        expect(JSON.parse(JSON.stringify(set))).toEqual(set)
        expect(setIcon(set, c.id, null)).toEqual(list)
      }),
    )
  })

  it('keeps the icon through the other operations', () => {
    const list = setIcon(listOf([tc('a', 'Tea'), tc('b')], 'a'), 'a', '🍵')
    const edited = setMuted(renameCard(moveCard(list, 'a', 1), 'a', 'Green tea'), 'a', true)
    expect(findCard(edited, 'a')).toMatchObject({ name: 'Green tea', muted: true, icon: '🍵' })
    const card = findCard(list, 'a')
    if (card === undefined) throw new Error('no card')
    const back = restoreCard(removeCard(list, 'a'), card, 0)
    expect(findCard(back, 'a')?.icon).toBe('🍵')
  })
})

describe('selectCard', () => {
  it('selects a card, keeping the cards array', () => {
    const list = grid(3, 0)
    const next = selectCard(list, 'c2')
    expect(next.selectedId).toBe('c2')
    expect(next.cards).toBe(list.cards)
  })

  it('ignores an unknown id and the selected card', () => {
    const list = grid(3, 0)
    expect(selectCard(list, 'nope')).toBe(list)
    expect(selectCard(list, 'c0')).toBe(list)
    expect(selectCard(EMPTY_LIST, 'c0')).toBe(EMPTY_LIST)
  })
})

describe('neighborIndex', () => {
  it('moves left and right along the list, stopping at the ends', () => {
    expect(neighborIndex(0, 5, 'left', 2)).toBe(0)
    expect(neighborIndex(3, 5, 'left', 2)).toBe(2)
    expect(neighborIndex(3, 5, 'right', 2)).toBe(4)
    expect(neighborIndex(4, 5, 'right', 2)).toBe(4)
  })

  it('moves up and down a row for columns 1 to 4', () => {
    // 7 cards: rows of `columns`, the last row partial.
    const cases: [number, number, Direction, number][] = [
      // [columns, from, direction, expected]
      [1, 3, 'up', 2],
      [1, 3, 'down', 4],
      [1, 6, 'down', 6],
      [2, 1, 'up', 1],
      [2, 3, 'up', 1],
      [2, 4, 'down', 6],
      [2, 5, 'down', 6], // into the shorter last row: its last card
      [3, 2, 'down', 5],
      [3, 4, 'down', 6],
      [3, 5, 'down', 6],
      [3, 6, 'down', 6], // the last row
      [3, 6, 'up', 3],
      [4, 3, 'down', 6],
      [4, 0, 'down', 4],
      [4, 5, 'up', 1],
      [4, 2, 'up', 2],
    ]
    for (const [columns, from, direction, expected] of cases) {
      expect(neighborIndex(from, 7, direction, columns), `${columns} ${from} ${direction}`).toBe(
        expected,
      )
    }
  })

  it('treats fewer than one or NaN columns as one, and floors fractions', () => {
    expect(neighborIndex(2, 5, 'down', 0)).toBe(3)
    expect(neighborIndex(2, 5, 'up', Number.NaN)).toBe(1)
    expect(neighborIndex(2, 5, 'down', 2.9)).toBe(4)
  })

  it('returns an index outside the list (or not an integer) unchanged', () => {
    expect(neighborIndex(-1, 3, 'right', 1)).toBe(-1)
    expect(neighborIndex(5, 3, 'left', 1)).toBe(5)
    expect(neighborIndex(0.5, 3, 'left', 2)).toBe(0.5)
  })

  it('always stays inside the list', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.integer({ min: 1, max: 6 }),
        fc.nat(),
        fc.constantFrom<Direction>('left', 'right', 'up', 'down'),
        (count, columns, seed, direction) => {
          const next = neighborIndex(seed % count, count, direction, columns)
          expect(next).toBeGreaterThanOrEqual(0)
          expect(next).toBeLessThan(count)
        },
      ),
    )
  })
})

describe('moveNeighbor', () => {
  it('moves the card one step on the grid and keeps the selection', () => {
    // 3 columns: c0 c1 c2 / c3 c4
    const list = grid(5, 1)
    expect(ids(moveNeighbor(list, 'c1', 'right', 3))).toEqual(['c0', 'c2', 'c1', 'c3', 'c4'])
    expect(ids(moveNeighbor(list, 'c1', 'down', 3))).toEqual(['c0', 'c2', 'c3', 'c4', 'c1'])
    expect(ids(moveNeighbor(list, 'c4', 'up', 3))).toEqual(['c0', 'c4', 'c1', 'c2', 'c3'])
    expect(moveNeighbor(list, 'c1', 'right', 3).selectedId).toBe('c1')
  })

  it('returns the list unchanged at an edge and for an unknown id', () => {
    const list = grid(3)
    expect(moveNeighbor(list, 'c0', 'left', 3)).toBe(list)
    expect(moveNeighbor(list, 'c0', 'up', 3)).toBe(list)
    expect(moveNeighbor(list, 'gone', 'right', 3)).toBe(list)
    expect(moveNeighbor(EMPTY_LIST, 'gone', 'right', 3)).toBe(EMPTY_LIST)
  })
})

describe('selectNeighbor', () => {
  const DIRECTIONS: readonly Direction[] = ['left', 'right', 'up', 'down']

  it('does nothing on an empty list', () => {
    for (const direction of DIRECTIONS) {
      expect(selectNeighbor(EMPTY_LIST, direction, 3)).toBe(EMPTY_LIST)
    }
  })

  it('selects the first card when nothing (or a missing card) is selected', () => {
    for (const direction of DIRECTIONS) {
      expect(selectNeighbor(listOf(grid(3).cards.slice(), null), direction, 2).selectedId).toBe(
        'c0',
      )
      expect(selectNeighbor(listOf(grid(3).cards.slice(), 'gone'), direction, 2).selectedId).toBe(
        'c0',
      )
    }
  })

  it('keeps the cards array', () => {
    const list = grid(3)
    expect(selectNeighbor(list, 'right', 3).cards).toBe(list.cards)
  })

  // [columns, card count, from index, direction, expected index]
  // Pictures show the grid filled row by row, e.g. 3 columns and 5 cards:
  //   0 1 2
  //   3 4
  const cases: [number, number, number, Direction, number][] = [
    // Left and right follow the order across rows and stop at the ends (no wrap).
    [3, 5, 2, 'right', 3],
    [3, 5, 3, 'left', 2],
    [3, 5, 0, 'left', 0],
    [3, 5, 4, 'right', 4],
    [1, 1, 0, 'left', 0],
    [1, 1, 0, 'right', 0],
    // One column: up and down step through the cards.
    [1, 3, 0, 'down', 1],
    [1, 3, 1, 'down', 2],
    [1, 3, 2, 'down', 2],
    [1, 3, 2, 'up', 1],
    [1, 3, 0, 'up', 0],
    // Two columns, full rows.
    [2, 4, 0, 'down', 2],
    [2, 4, 1, 'down', 3],
    [2, 4, 2, 'down', 2],
    [2, 4, 3, 'down', 3],
    [2, 4, 2, 'up', 0],
    [2, 4, 3, 'up', 1],
    [2, 4, 1, 'up', 1],
    // Two columns, partial last row: 0 1 / 2.
    [2, 3, 0, 'down', 2],
    [2, 3, 1, 'down', 2],
    [2, 3, 2, 'down', 2],
    [2, 3, 2, 'up', 0],
    // Three columns, partial last row: 0 1 2 / 3 4.
    [3, 5, 0, 'down', 3],
    [3, 5, 1, 'down', 4],
    [3, 5, 2, 'down', 4],
    [3, 5, 3, 'down', 3],
    [3, 5, 4, 'down', 4],
    [3, 5, 3, 'up', 0],
    [3, 5, 4, 'up', 1],
    [3, 5, 0, 'up', 0],
    [3, 5, 2, 'up', 2],
    // Four columns, three rows with a partial last row: 0 1 2 3 / 4 5 6 7 / 8 9.
    [4, 10, 1, 'down', 5],
    [4, 10, 5, 'down', 9],
    [4, 10, 6, 'down', 9],
    [4, 10, 7, 'down', 9],
    [4, 10, 8, 'down', 8],
    [4, 10, 9, 'up', 5],
    [4, 10, 5, 'up', 1],
    [4, 10, 3, 'up', 3],
    // Four columns but fewer cards: a single row, so up and down do nothing.
    [4, 3, 0, 'down', 0],
    [4, 3, 2, 'down', 2],
    [4, 3, 1, 'up', 1],
    [4, 3, 1, 'right', 2],
  ]

  it.each(cases)(
    'with %i columns and %i cards, from %i going %s lands on %i',
    (cols, n, from, dir, to) => {
      const list = grid(n, from)
      const next = selectNeighbor(list, dir, cols)
      expect(next.selectedId).toBe(`c${to}`)
      if (to === from) expect(next).toBe(list)
    },
  )

  it('treats fewer than one column, NaN and fractions sensibly', () => {
    const list = grid(4, 1)
    expect(selectNeighbor(list, 'down', 0).selectedId).toBe('c2')
    expect(selectNeighbor(list, 'down', -3).selectedId).toBe('c2')
    expect(selectNeighbor(list, 'down', Number.NaN).selectedId).toBe('c2')
    expect(selectNeighbor(list, 'down', 2.9).selectedId).toBe('c3')
    expect(selectNeighbor(list, 'down', Number.POSITIVE_INFINITY)).toBe(list)
  })
})

describe('updateTimer and updateStopwatch', () => {
  const list = listOf([tc('t'), sc('s')], 't')

  it('applies the update to the right card and keeps the rest', () => {
    const next = updateTimer(list, 't', (t) => timer.start(t, NOW))
    expect(next.cards[0]).toEqual({ ...tc('t'), timer: running(NOW + 5 * MINUTE) })
    expect(next.cards[1]).toBe(list.cards[1])
    expect(next.selectedId).toBe('t')

    const laps = updateStopwatch(list, 's', (s) => stopwatch.start(s, NOW))
    expect(laps.cards[1]).toEqual({
      ...sc('s'),
      stopwatch: stopwatch.start({ phase: 'idle' }, NOW),
    })
    expect(laps.cards[0]).toBe(list.cards[0])
  })

  it('returns the list unchanged when the update is a no-op', () => {
    expect(updateTimer(list, 't', (t) => timer.pause(t, NOW))).toBe(list)
    expect(updateStopwatch(list, 's', (s) => stopwatch.reset(s))).toBe(list)
  })

  it('ignores unknown ids and cards of the other kind without calling the update', () => {
    let calls = 0
    const count = <T>(s: T): T => {
      calls++
      return s
    }
    expect(updateTimer(list, 's', count)).toBe(list)
    expect(updateTimer(list, 'nope', count)).toBe(list)
    expect(updateStopwatch(list, 't', count)).toBe(list)
    expect(updateStopwatch(EMPTY_LIST, 's', count)).toBe(EMPTY_LIST)
    expect(calls).toBe(0)
  })
})

describe('findCard and selectedCard', () => {
  it('finds cards by id and the selected card', () => {
    const list = grid(3, 1)
    expect(findCard(list, 'c2')).toBe(list.cards[2])
    expect(findCard(list, 'nope')).toBeUndefined()
    expect(selectedCard(list)).toBe(list.cards[1])
  })

  it('has no selected card for an empty list, no selection or a stale one', () => {
    expect(selectedCard(EMPTY_LIST)).toBeUndefined()
    expect(selectedCard(listOf([tc('a')], null))).toBeUndefined()
    expect(selectedCard(listOf([tc('a')], 'gone'))).toBeUndefined()
  })
})

describe('settleAll', () => {
  it('returns the list unchanged when no timer has reached its end', () => {
    expect(settleAll(EMPTY_LIST, NOW)).toBe(EMPTY_LIST)
    const list = listOf([
      tc('idle'),
      tc('soon', 'soon', running(NOW + SECOND)),
      tc('paused', 'paused', { phase: 'paused', duration: MINUTE, remaining: 0 }),
      tc('ringing', 'ringing', { phase: 'ringing', duration: MINUTE, endedAt: NOW - MINUTE }),
      sc('sw', 'sw', stopwatch.start({ phase: 'idle' }, NOW - MINUTE)),
    ])
    expect(settleAll(list, NOW)).toBe(list)
  })

  it('rings every timer whose end has come, dated from its end, and keeps the others', () => {
    const list = listOf(
      [
        tc('done', 'done', running(NOW - 2 * SECOND)),
        tc('later', 'later', running(NOW + MINUTE)),
        tc('exact', 'exact', running(NOW)),
      ],
      'later',
    )
    const next = settleAll(list, NOW)
    expect(next.cards.map((card) => (card.kind === 'timer' ? card.timer : null))).toEqual([
      { phase: 'ringing', duration: 5 * MINUTE, endedAt: NOW - 2 * SECOND },
      running(NOW + MINUTE),
      { phase: 'ringing', duration: 5 * MINUTE, endedAt: NOW },
    ])
    expect(next.cards[1]).toBe(list.cards[1])
    expect(next.selectedId).toBe('later')
    expect(settleAll(next, NOW + SECOND)).toBe(next)
  })
})

describe('nextDeadline', () => {
  it('is null when no timer runs', () => {
    expect(nextDeadline(EMPTY_LIST)).toBeNull()
    const list = listOf([
      tc('idle'),
      tc('paused', 'p', { phase: 'paused', duration: MINUTE, remaining: SECOND }),
      tc('ringing', 'r', { phase: 'ringing', duration: MINUTE, endedAt: NOW }),
      sc('sw', 'sw', stopwatch.start({ phase: 'idle' }, NOW)),
    ])
    expect(nextDeadline(list)).toBeNull()
  })

  it('is the end of the only running timer', () => {
    expect(nextDeadline(listOf([tc('a'), tc('b', 'b', running(NOW + MINUTE))]))).toBe(NOW + MINUTE)
  })

  it('is the earliest end among running timers, past ones included', () => {
    const list = listOf([
      tc('a', 'a', running(NOW + 3 * MINUTE)),
      tc('b', 'b', running(NOW + MINUTE)),
      tc('c', 'c', running(NOW + 2 * MINUTE)),
    ])
    expect(nextDeadline(list)).toBe(NOW + MINUTE)
    expect(nextDeadline(listOf([...list.cards, tc('d', 'd', running(NOW - SECOND))]))).toBe(
      NOW - SECOND,
    )
  })
})

describe('anyNeedsFrames', () => {
  it('is false when every display is still', () => {
    expect(anyNeedsFrames(EMPTY_LIST)).toBe(false)
    const still = listOf([
      tc('idle'),
      tc('paused', 'p', { phase: 'paused', duration: MINUTE, remaining: SECOND }),
      sc('idle-sw'),
      sc('paused-sw', 'ps', { phase: 'paused', accumulated: SECOND, laps: [] }),
    ])
    expect(anyNeedsFrames(still)).toBe(false)
  })

  it('is true when a timer runs or rings, or a stopwatch runs', () => {
    expect(anyNeedsFrames(listOf([tc('a'), tc('b', 'b', running(NOW + MINUTE))]))).toBe(true)
    const ringing: TimerState = { phase: 'ringing', duration: MINUTE, endedAt: NOW }
    expect(anyNeedsFrames(listOf([tc('a', 'a', ringing)]))).toBe(true)
    expect(anyNeedsFrames(listOf([sc('s', 's', stopwatch.start({ phase: 'idle' }, NOW))]))).toBe(
      true,
    )
  })
})

describe('applyTyped', () => {
  it('leaves the timer alone when nothing is typed', () => {
    const t = timer.createTimer(MINUTE)
    expect(applyTyped(t, '')).toBe(t)
  })

  it('sets the typed duration, normalizing overflow, and resets a paused or ringing timer', () => {
    expect(applyTyped(timer.createTimer(MINUTE), '90')).toEqual({
      phase: 'idle',
      duration: 90 * SECOND,
    })
    const paused: TimerState = { phase: 'paused', duration: MINUTE, remaining: SECOND }
    expect(applyTyped(paused, '13030')).toEqual({
      phase: 'idle',
      duration: (3600 + 30 * 60 + 30) * SECOND,
    })
    const ringing: TimerState = { phase: 'ringing', duration: MINUTE, endedAt: NOW }
    expect(applyTyped(ringing, '5')).toEqual({ phase: 'idle', duration: 5 * SECOND })
  })

  it('leaves a running timer alone and returns the same state for the same duration', () => {
    const run = running(NOW + MINUTE)
    expect(applyTyped(run, '30')).toBe(run)
    const idle = timer.createTimer(30 * SECOND)
    expect(applyTyped(idle, '30')).toBe(idle)
  })
})

describe('normalizeList', () => {
  it('returns a list that follows the rules unchanged', () => {
    const list = grid(3, 1)
    expect(normalizeList(list)).toBe(list)
    expect(normalizeList(EMPTY_LIST)).toBe(EMPTY_LIST)
  })

  it('drops later cards with a repeated id', () => {
    const list = listOf([tc('a', 'first'), tc('b'), tc('a', 'second')], 'b')
    expect(normalizeList(list)).toEqual({ cards: [tc('a', 'first'), tc('b')], selectedId: 'b' })
  })

  it('selects the first card when the selection is missing or stale', () => {
    expect(normalizeList(listOf([tc('a'), tc('b')], null)).selectedId).toBe('a')
    expect(normalizeList(listOf([tc('a'), tc('b')], 'gone')).selectedId).toBe('a')
    const empty = listOf([], 'gone')
    expect(normalizeList(empty)).toEqual(EMPTY_LIST)
  })
})

describe('JSON', () => {
  it('round-trips a list with cards in every phase', () => {
    let list: CardList = EMPTY_LIST
    list = addCard(list, tc('idle', 'Tea', timer.createTimer(3 * MINUTE)))
    list = addCard(list, tc('run', 'Run', running(NOW + MINUTE)))
    list = addCard(
      list,
      tc('pause', 'Pause', { phase: 'paused', duration: MINUTE, remaining: SECOND }),
    )
    list = addCard(list, tc('ring', 'Ring', { phase: 'ringing', duration: MINUTE, endedAt: NOW }))
    list = addCard(list, sc('sw-idle'))
    list = addCard(
      list,
      sc('sw-run', 'Laps', stopwatch.lap(stopwatch.start({ phase: 'idle' }, NOW), NOW + SECOND)),
    )
    list = setMuted(list, 'ring', true)
    list = selectCard(list, 'pause')
    expect(JSON.parse(JSON.stringify(list))).toEqual(list)
  })
})

describe('random operation sequences', () => {
  const POOL = ['a', 'b', 'c', 'd', 'e', 'f'] as const
  type Op =
    | { op: 'addTimer' | 'addStopwatch'; id: CardId; index: number | undefined }
    | { op: 'remove' | 'select'; id: CardId }
    | { op: 'restore'; index: number }
    | { op: 'rename'; id: CardId; name: string }
    | { op: 'move'; id: CardId; to: number }
    | { op: 'mute'; id: CardId; muted: boolean }
    | { op: 'icon'; id: CardId; icon: string | null }
    | { op: 'neighbor'; direction: Direction; columns: number }
    | { op: 'timer'; id: CardId; action: 'start' | 'pause' | 'reset' }
    | { op: 'stopwatch'; id: CardId; action: 'start' | 'lap' | 'reset' }
    | { op: 'settle' }

  const idArb = fc.constantFrom(...POOL)
  const indexArb = fc.oneof(fc.integer({ min: -2, max: 8 }), fc.constant(Number.NaN))
  const opArb: fc.Arbitrary<Op> = fc.oneof(
    fc.record({
      op: fc.constantFrom('addTimer' as const, 'addStopwatch' as const),
      id: idArb,
      index: fc.option(fc.integer({ min: -2, max: 8 }), { nil: undefined }),
    }),
    fc.record({ op: fc.constantFrom('remove' as const, 'select' as const), id: idArb }),
    fc.record({ op: fc.constant('restore' as const), index: indexArb }),
    fc.record({ op: fc.constant('rename' as const), id: idArb, name: fc.string({ maxLength: 6 }) }),
    fc.record({ op: fc.constant('move' as const), id: idArb, to: indexArb }),
    fc.record({ op: fc.constant('mute' as const), id: idArb, muted: fc.boolean() }),
    fc.record({
      op: fc.constant('icon' as const),
      id: idArb,
      icon: fc.constantFrom('🍵', '🇹🇼', 'abc', null),
    }),
    fc.record({
      op: fc.constant('neighbor' as const),
      direction: fc.constantFrom<Direction>('left', 'right', 'up', 'down'),
      columns: fc.integer({ min: -1, max: 5 }),
    }),
    fc.record({
      op: fc.constant('timer' as const),
      id: idArb,
      action: fc.constantFrom('start' as const, 'pause' as const, 'reset' as const),
    }),
    fc.record({
      op: fc.constant('stopwatch' as const),
      id: idArb,
      action: fc.constantFrom('start' as const, 'lap' as const, 'reset' as const),
    }),
    fc.record({ op: fc.constant('settle' as const) }),
  )

  /** Runs `ops` from the empty list, checking `check(before, after)` after every step. */
  function run(ops: readonly Op[], check: (before: CardList, after: CardList) => void): void {
    let list: CardList = EMPTY_LIST
    let removed: { card: Card; index: number } | null = null
    let now = NOW
    for (const step of ops) {
      now += 7 * SECOND
      const before = deepFreeze(list)
      switch (step.op) {
        case 'addTimer':
          list = addCard(
            list,
            createTimerCard(step.id, nextDefaultName(list, 'timer'), now, MINUTE),
            step.index,
          )
          break
        case 'addStopwatch':
          list = addCard(
            list,
            createStopwatchCard(step.id, nextDefaultName(list, 'stopwatch'), now),
            step.index,
          )
          break
        case 'remove': {
          const index = list.cards.findIndex((card) => card.id === step.id)
          const card = list.cards[index]
          if (card !== undefined) removed = { card, index }
          list = removeCard(list, step.id)
          break
        }
        case 'restore':
          if (removed !== null) list = restoreCard(list, removed.card, step.index)
          break
        case 'select':
          list = selectCard(list, step.id)
          break
        case 'rename':
          list = renameCard(list, step.id, step.name)
          break
        case 'move':
          list = moveCard(list, step.id, step.to)
          break
        case 'mute':
          list = setMuted(list, step.id, step.muted)
          break
        case 'icon':
          list = setIcon(list, step.id, step.icon)
          break
        case 'neighbor':
          list = selectNeighbor(list, step.direction, step.columns)
          break
        case 'timer': {
          const at = now
          list = updateTimer(list, step.id, (t) =>
            step.action === 'reset' ? timer.reset(t) : timer[step.action](t, at),
          )
          break
        }
        case 'stopwatch': {
          const at = now
          list = updateStopwatch(list, step.id, (s) =>
            step.action === 'reset' ? stopwatch.reset(s) : stopwatch[step.action](s, at),
          )
          break
        }
        case 'settle':
          list = settleAll(list, now)
          break
      }
      check(before, list)
    }
  }

  const opsArb = fc.array(opArb, { minLength: 1, maxLength: 40 })

  it('keeps ids unique and the selection on an existing card (none only when empty)', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        run(ops, (_, list) => {
          const unique = new Set(ids(list))
          expect(unique.size).toBe(list.cards.length)
          if (list.cards.length === 0) expect(list.selectedId).toBeNull()
          else expect(list.selectedId !== null && unique.has(list.selectedId)).toBe(true)
        })
      }),
      { numRuns: 500 },
    )
  })

  it('keeps every name trimmed and non-empty, and every list JSON-safe and normal', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        run(ops, (_, list) => {
          for (const card of list.cards) {
            expect(card.name).toBe(card.name.trim())
            expect(card.name).not.toBe('')
          }
          expect(JSON.parse(JSON.stringify(list))).toEqual(list)
          expect(normalizeList(list)).toBe(list)
        })
      }),
      { numRuns: 300 },
    )
  })

  it('returns the same list exactly when nothing changed, and never mutates its input', () => {
    fc.assert(
      fc.property(opsArb, (ops) => {
        // Inputs are deep-frozen, so a mutation would throw.
        run(ops, (before, after) => {
          const same = JSON.stringify(before) === JSON.stringify(after)
          expect(after === before).toBe(same)
        })
      }),
      { numRuns: 300 },
    )
  })
})
