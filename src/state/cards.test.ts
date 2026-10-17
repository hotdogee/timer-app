import { describe, expect, it, vi } from 'vitest'

import { cards, stopwatch, timer, type EpochMs, type TimerState } from '../core'
import { cardStore, createCardStore, type CardStore } from './cards.svelte'

// The app singleton reads ids from the platform layer; keep this test independent of it.
vi.mock('../platform', () => ({ platform: { ids: { newId: () => 'first-run' } } }))

const SECOND = 1000
const MINUTE = 60 * SECOND

/** 14:47 UTC on 2026-10-17. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

/** A store with counting ids ('id1', 'id2', …), a clock fixed at `createdAt`, and a scripted `now`. */
function setup(ids: () => string = counter()): {
  store: CardStore
  bumps: () => number
  setNow: (at: EpochMs) => void
} {
  let now = NOW
  let bumps = 0
  const store = createCardStore({
    newId: ids,
    clock: () => NOW - MINUTE,
    bump: () => {
      bumps++
      return now
    },
  })
  return {
    store,
    bumps: () => bumps,
    setNow: (at) => {
      now = at
    },
  }
}

function counter(): () => string {
  let n = 0
  return () => `id${++n}`
}

const timerOf = (store: CardStore, id: string): TimerState | undefined => {
  const card = cards.findCard(store.list, id)
  return card?.kind === 'timer' ? card.timer : undefined
}

describe('createCardStore', () => {
  it('starts empty, with nothing selected or removed', () => {
    const { store } = setup()
    expect(store.list).toBe(cards.EMPTY_LIST)
    expect(store.cards).toEqual([])
    expect(store.selected).toBeUndefined()
    expect(store.lastRemoved).toBeNull()
  })
})

describe('adding cards', () => {
  it('adds a selected 5:00 "Timer", created at the clock time, and returns its id', () => {
    const { store } = setup()
    const id = store.addTimer()
    expect(id).toBe('id1')
    expect(store.cards).toEqual([cards.createTimerCard('id1', 'Timer', NOW - MINUTE)])
    expect(store.selected?.id).toBe('id1')
    expect(store.list.selectedId).toBe('id1')
  })

  it('numbers further cards and selects each new one', () => {
    const { store } = setup()
    store.addTimer()
    store.addTimer()
    store.addStopwatch()
    const last = store.addStopwatch()
    expect(store.cards.map((card) => card.name)).toEqual([
      'Timer',
      'Timer 2',
      'Stopwatch',
      'Stopwatch 2',
    ])
    expect(store.selected?.id).toBe(last)
    expect(store.selected?.kind).toBe('stopwatch')
  })

  it('uses a given duration and name, numbering a repeated name', () => {
    const { store } = setup()
    const tea = store.addTimer(3 * MINUTE, 'Tea')
    const tea2 = store.addTimer(3 * MINUTE, ' Tea ')
    const blank = store.addTimer(undefined, '  ')
    expect(timerOf(store, tea)).toEqual({ phase: 'idle', duration: 3 * MINUTE })
    expect(store.cards.map((card) => card.name)).toEqual(['Tea', 'Tea 2', 'Timer'])
    expect(timerOf(store, blank)).toEqual({ phase: 'idle', duration: 5 * MINUTE })
    expect(tea2).not.toBe(tea)
    expect(store.addStopwatch('Laps')).toBe('id4')
    expect(store.selected?.name).toBe('Laps')
  })

  it('keeps ids unique even when the id source repeats itself', () => {
    const { store } = setup(() => 'same')
    const ids = [store.addTimer(), store.addTimer(), store.addStopwatch()]
    expect(ids).toEqual(['same', 'same-2', 'same-3'])
    expect(new Set(store.cards.map((card) => card.id)).size).toBe(3)
  })

  it('replaces the list whole and leaves the old one untouched', () => {
    const { store } = setup()
    store.addTimer()
    const before = store.list
    store.addTimer()
    expect(store.list).not.toBe(before)
    expect(before.cards).toHaveLength(1)
  })
})

describe('removing and undoing', () => {
  it('removes a card, moves the selection and remembers the card and its position', () => {
    const { store } = setup()
    const a = store.addTimer()
    const b = store.addTimer()
    store.addTimer()
    store.select(b)
    const removed = store.selected
    store.remove(b)
    expect(store.cards.map((card) => card.id)).toEqual([a, 'id3'])
    expect(store.selected?.id).toBe('id3')
    expect(store.lastRemoved).toEqual({ card: removed, index: 1 })
  })

  it('ignores an unknown id and keeps what it remembered', () => {
    const { store } = setup()
    const a = store.addTimer()
    store.addTimer()
    store.remove(a)
    const list = store.list
    const remembered = store.lastRemoved
    store.remove('nope')
    expect(store.list).toBe(list)
    expect(store.lastRemoved).toBe(remembered)
  })

  it('undoes the last delete at the same position, selects the card, and only once', () => {
    const { store } = setup()
    store.addTimer()
    const b = store.addStopwatch()
    store.addTimer()
    const original = store.cards
    store.remove(b)
    expect(store.undoRemove()).toBe(true)
    expect(store.cards).toEqual(original)
    expect(store.selected?.id).toBe(b)
    expect(store.lastRemoved).toBeNull()
    expect(store.undoRemove()).toBe(false)
  })

  it('keeps a removed timer running, so it rings on time after an undo', () => {
    const { store, setNow } = setup()
    const id = store.addTimer(MINUTE)
    store.timer(id, timer.start)
    store.remove(id)
    expect(store.undoRemove()).toBe(true)
    expect(timerOf(store, id)).toEqual({ phase: 'running', duration: MINUTE, endsAt: NOW + MINUTE })
    setNow(NOW + MINUTE)
    store.settle(NOW + MINUTE)
    expect(timerOf(store, id)?.phase).toBe('ringing')
  })

  it('cannot undo once the delete is forgotten or nothing was deleted', () => {
    const { store } = setup()
    expect(store.undoRemove()).toBe(false)
    const id = store.addTimer()
    store.remove(id)
    store.forgetRemoved()
    expect(store.lastRemoved).toBeNull()
    expect(store.undoRemove()).toBe(false)
    expect(store.cards).toEqual([])
  })

  it('does not restore a card whose id is back in the list', () => {
    const { store } = setup()
    const id = store.addTimer()
    const list = store.list
    store.remove(id)
    store.replace(list)
    expect(store.undoRemove()).toBe(false)
    expect(store.cards).toHaveLength(1)
    expect(store.lastRemoved).toBeNull()
  })

  it('remembers only the latest delete', () => {
    const { store } = setup()
    store.addTimer()
    store.addTimer()
    store.addTimer()
    store.remove('id3')
    store.remove('id1')
    expect(store.lastRemoved?.card.id).toBe('id1')
    expect(store.undoRemove()).toBe(true)
    expect(store.cards.map((card) => card.id)).toEqual(['id1', 'id2'])
    expect(store.undoRemove()).toBe(false)
  })

  it('renumbers a restored card whose name a newer card took (no two cards share a name)', () => {
    const { store } = setup()
    store.addTimer()
    store.addTimer()
    store.addTimer()
    store.remove('id2')
    const newer = store.addTimer()
    expect(cards.findCard(store.list, newer)?.name).toBe('Timer 2')
    expect(store.undoRemove()).toBe(true)
    expect(store.cards.map((card) => card.name)).toEqual(['Timer', 'Timer 4', 'Timer 3', 'Timer 2'])
    expect(store.selected?.id).toBe('id2')
  })

  it('restores at the end when the list shrank since', () => {
    const { store } = setup()
    store.addTimer()
    store.addTimer()
    store.addTimer()
    store.remove('id3')
    store.replace(cards.removeCard(store.list, 'id2'))
    expect(store.undoRemove()).toBe(true)
    expect(store.cards.map((card) => card.id)).toEqual(['id1', 'id3'])
    expect(store.selected?.id).toBe('id3')
  })
})

describe('editing and selection', () => {
  it('renames, moves, mutes and selects through the model', () => {
    const { store } = setup()
    const a = store.addTimer()
    const b = store.addTimer()
    store.addTimer()
    store.rename(a, '  Tea ')
    store.move(a, 2)
    store.setMuted(b, true)
    store.select(b)
    expect(store.cards.map((card) => [card.id, card.name, card.muted])).toEqual([
      ['id2', 'Timer 2', true],
      ['id3', 'Timer 3', false],
      ['id1', 'Tea', false],
    ])
    expect(store.selected?.id).toBe(b)
  })

  it('leaves the list object alone when nothing changes', () => {
    const { store } = setup()
    const a = store.addTimer()
    const list = store.list
    store.rename(a, '   ')
    store.move(a, 5)
    store.setMuted(a, false)
    store.select('nope')
    store.selectNeighbor('left', 3)
    store.settle(NOW)
    store.timer('nope', timer.start)
    store.stopwatch(a, stopwatch.start)
    store.replace(list)
    expect(store.list).toBe(list)
  })

  it('moves the selection by grid geometry', () => {
    const { store } = setup()
    for (let i = 0; i < 5; i++) store.addTimer()
    store.select('id2')
    store.selectNeighbor('down', 3)
    expect(store.selected?.id).toBe('id5')
    store.selectNeighbor('up', 3)
    expect(store.selected?.id).toBe('id2')
    store.selectNeighbor('right', 3)
    expect(store.selected?.id).toBe('id3')
  })

  it('moves a card by grid geometry and keeps it selected', () => {
    const { store } = setup()
    for (let i = 0; i < 5; i++) store.addTimer()
    store.select('id2')
    store.moveNeighbor('id2', 'down', 3)
    expect(store.cards.map((card) => card.id)).toEqual(['id1', 'id3', 'id4', 'id5', 'id2'])
    const list = store.list
    store.moveNeighbor('id2', 'right', 3)
    expect(store.list).toBe(list)
    expect(store.selected?.id).toBe('id2')
  })
})

describe('timer and stopwatch actions', () => {
  it('reads the clock once per action and passes that time to the update', () => {
    const { store, bumps, setNow } = setup()
    const id = store.addTimer(MINUTE)
    setNow(NOW + SECOND)
    const seen: EpochMs[] = []
    store.timer(id, (t, now) => {
      seen.push(now)
      return timer.start(t, now)
    })
    expect(bumps()).toBe(1)
    expect(seen).toEqual([NOW + SECOND])
    expect(timerOf(store, id)).toEqual({
      phase: 'running',
      duration: MINUTE,
      endsAt: NOW + SECOND + MINUTE,
    })
  })

  it('settles every timer at the action time', () => {
    const { store, setNow } = setup()
    const short = store.addTimer(SECOND)
    const other = store.addTimer(MINUTE)
    store.timer(short, timer.start)
    setNow(NOW + 2 * SECOND)
    store.timer(other, timer.start)
    expect(timerOf(store, short)).toEqual({
      phase: 'ringing',
      duration: SECOND,
      endedAt: NOW + SECOND,
    })
    expect(timerOf(store, other)?.phase).toBe('running')
  })

  it('applies stopwatch actions and ignores timer actions on a stopwatch', () => {
    const { store, setNow } = setup()
    const id = store.addStopwatch()
    store.stopwatch(id, stopwatch.start)
    setNow(NOW + 1500)
    store.stopwatch(id, stopwatch.lap)
    const card = store.selected
    expect(card?.kind === 'stopwatch' ? card.stopwatch : null).toEqual({
      phase: 'running',
      startedAt: NOW,
      accumulated: 0,
      laps: [1500],
    })
    const list = store.list
    store.timer(id, timer.start)
    expect(store.list).toBe(list)
  })

  it('settles on demand', () => {
    const { store } = setup()
    const id = store.addTimer(SECOND)
    store.timer(id, timer.start)
    store.settle(NOW + 500)
    expect(timerOf(store, id)?.phase).toBe('running')
    store.settle(NOW + SECOND)
    expect(timerOf(store, id)?.phase).toBe('ringing')
  })
})

describe('replace', () => {
  it('loads a list, dropping repeated ids and repairing the selection', () => {
    const { store } = setup()
    const a = cards.createTimerCard('a', 'Tea', NOW)
    const b = cards.createStopwatchCard('b', 'Laps', NOW)
    store.replace({ cards: [a, b, { ...a, name: 'Copy' }], selectedId: 'gone' })
    expect(store.cards).toEqual([a, b])
    expect(store.selected).toEqual(a)
  })

  it('keeps a list that already follows the rules as it is', () => {
    const { store } = setup()
    const list = cards.addCard(cards.EMPTY_LIST, cards.createTimerCard('a', 'Tea', NOW))
    store.replace(list)
    expect(store.list).toBe(list)
  })
})

describe('cardStore', () => {
  it('starts as on first run: one selected 5:00 "Timer"', () => {
    expect(cardStore.cards).toHaveLength(1)
    const card = cardStore.selected
    expect(card?.id).toBe('first-run')
    expect(card?.name).toBe('Timer')
    expect(card?.kind === 'timer' ? card.timer : null).toEqual({
      phase: 'idle',
      duration: 5 * MINUTE,
    })
  })
})
