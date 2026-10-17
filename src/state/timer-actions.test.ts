import { describe, expect, it, vi } from 'vitest'

import { digits, timer } from '../core'
import { createCardStore, type CardStore } from './cards.svelte'
import { runTimer, startTimer, toggleTimer } from './timer-actions'

// The store module's app singleton reads ids from the platform layer; keep these tests off it.
vi.mock('../platform', () => ({ platform: { ids: { newId: () => 'first-run' } } }))

const SECOND = 1000
const MINUTE = 60 * SECOND
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

/** A store at a fixed `now` with counting ids; `kind` adds one selected card, 'id1'. */
function setup(kind: 'timer' | 'stopwatch') {
  let n = 0
  const store: CardStore = createCardStore({
    newId: () => `id${++n}`,
    clock: () => NOW - MINUTE,
    bump: () => NOW,
  })
  if (kind === 'timer') store.addTimer()
  else store.addStopwatch()
  const timerState = (id: string) => {
    const card = store.cards.find((c) => c.id === id)
    return card?.kind === 'timer' ? card.timer : undefined
  }
  return { store, timerState }
}

const withTimer = () => setup('timer')
const withStopwatch = () => setup('stopwatch')

describe('runTimer', () => {
  it('reports starts, resumes and restarts, but not other transitions', () => {
    const s = withTimer()
    const onStart = vi.fn()
    runTimer(s.store, 'id1', timer.start, onStart)
    runTimer(s.store, 'id1', timer.start, onStart) // already running
    runTimer(s.store, 'id1', timer.pause, onStart)
    runTimer(s.store, 'id1', timer.start, onStart) // resume
    s.store.settle(NOW + 10 * MINUTE)
    runTimer(s.store, 'id1', timer.restart, onStart)
    runTimer(s.store, 'id1', timer.reset, onStart)
    expect(onStart).toHaveBeenCalledTimes(3)
  })

  it('ignores unknown ids and stopwatches and works without a callback', () => {
    const s = withStopwatch()
    const onStart = vi.fn()
    runTimer(s.store, 'id1', timer.start, onStart)
    runTimer(s.store, 'nope', timer.start, onStart)
    runTimer(s.store, 'id1', timer.start)
    expect(onStart).not.toHaveBeenCalled()
  })
})

describe('toggleTimer and startTimer', () => {
  it('toggle applies typed digits first, then starts (90 runs as 1:30)', () => {
    const s = withTimer()
    const onStart = vi.fn()
    toggleTimer(s.store, 'id1', '90', onStart)
    expect(s.timerState('id1')).toEqual({
      phase: 'running',
      duration: 90 * SECOND,
      endsAt: NOW + 90 * SECOND,
    })
    expect(onStart).toHaveBeenCalledWith('id1')
  })

  it('toggle pauses a running timer and dismisses a ringing one', () => {
    const s = withTimer()
    toggleTimer(s.store, 'id1', digits.EMPTY)
    toggleTimer(s.store, 'id1', digits.EMPTY)
    expect(s.timerState('id1')?.phase).toBe('paused')
    toggleTimer(s.store, 'id1', digits.EMPTY)
    s.store.settle(NOW + 10 * MINUTE)
    expect(s.timerState('id1')?.phase).toBe('ringing')
    toggleTimer(s.store, 'id1', digits.EMPTY)
    expect(s.timerState('id1')).toEqual({ phase: 'idle', duration: 5 * MINUTE })
  })

  it('toggle with digits on a ringing timer starts the new duration', () => {
    const s = withTimer()
    toggleTimer(s.store, 'id1', digits.EMPTY)
    s.store.settle(NOW + 10 * MINUTE)
    toggleTimer(s.store, 'id1', '2')
    expect(s.timerState('id1')).toMatchObject({ phase: 'running', duration: 2 * SECOND })
  })

  it('start with digits sets the duration and starts; without, dismisses a ringing timer', () => {
    const s = withTimer()
    startTimer(s.store, 'id1', '1', undefined)
    expect(s.timerState('id1')).toMatchObject({ phase: 'running', duration: SECOND })
    s.store.settle(NOW + 5 * SECOND)
    startTimer(s.store, 'id1', digits.EMPTY)
    expect(s.timerState('id1')).toEqual({ phase: 'idle', duration: SECOND })
  })
})
