import { describe, expect, it } from 'vitest'

import { cards, keymap, stopwatch, timer, type cards as Cards } from '../../core'
import { MINI_PATH, miniCardId, miniControls, miniKey, miniPath } from './mini'

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0)

function timerCard(state = timer.createTimer(300_000)): Cards.TimerCard {
  return { id: 't1', kind: 'timer', name: 'Tea', createdAt: T0, muted: false, timer: state }
}

function stopwatchCard(state = stopwatch.createStopwatch()): Cards.StopwatchCard {
  return { id: 's1', kind: 'stopwatch', name: 'Run', createdAt: T0, muted: false, stopwatch: state }
}

function key(k: string, mods: Partial<keymap.KeyEventLike> = {}): keymap.KeyEventLike {
  return { key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

describe('the mini window page address', () => {
  it('reads the card from the query string', () => {
    expect(miniCardId('?card=abc-123')).toBe('abc-123')
    expect(miniCardId('?card=%20x%20')).toBe('x')
    expect(miniCardId('?card=')).toBeNull()
    expect(miniCardId('')).toBeNull()
  })

  it('writes the page path for a card', () => {
    expect(miniPath('a b&c')).toBe(`${MINI_PATH}?card=a+b%26c`)
    expect(miniCardId(miniPath('a b&c').slice(MINI_PATH.length))).toBe('a b&c')
  })
})

describe('miniControls', () => {
  it("gives a timer its phase's buttons and +1:00 while that adds time", () => {
    const idle = timer.createTimer(300_000)
    const running = timer.start(idle, T0)
    const paused = timer.pause(running, T0 + 1000)
    const ringing = timer.settle(running, T0 + 400_000)
    expect(miniControls(timerCard(idle))).toEqual(['start', 'add'])
    expect(miniControls(timerCard(running))).toEqual(['pause', 'reset', 'add'])
    expect(miniControls(timerCard(paused))).toEqual(['resume', 'reset', 'add'])
    expect(ringing.phase).toBe('ringing')
    expect(miniControls(timerCard(ringing))).toEqual(['dismiss', 'restart'])
  })

  it('gives a stopwatch start, pause, lap and reset', () => {
    const idle = stopwatch.createStopwatch()
    const running = stopwatch.start(idle, T0)
    expect(miniControls(stopwatchCard(idle))).toEqual(['start'])
    expect(miniControls(stopwatchCard(running))).toEqual(['pause', 'lap', 'reset'])
    expect(miniControls(stopwatchCard(stopwatch.pause(running, T0 + 5)))).toEqual([
      'resume',
      'reset',
    ])
  })

  it('works with the cards the model makes', () => {
    expect(miniControls(cards.createTimerCard('x', 'Timer', T0))).toEqual(['start', 'add'])
    expect(miniControls(cards.createStopwatchCard('y', 'Stopwatch', T0))).toEqual(['start'])
  })
})

describe('miniKey', () => {
  const bindings = keymap.DEFAULT_BINDINGS

  it('maps the default keys', () => {
    expect(miniKey(bindings, key(' '), 'other')).toBe('toggle')
    expect(miniKey(bindings, key('Enter'), 'other')).toBe('start')
    expect(miniKey(bindings, key('r'), 'other')).toBe('reset')
    expect(miniKey(bindings, key('l'), 'other')).toBe('lap')
    expect(miniKey(bindings, key('Escape'), 'other')).toBe('close')
  })

  it('ignores keys that do something else in the app, or nothing', () => {
    expect(miniKey(bindings, key('n'), 'other')).toBeNull()
    expect(miniKey(bindings, key('k', { ctrlKey: true }), 'other')).toBeNull()
    expect(miniKey(bindings, key('5'), 'other')).toBeNull()
  })

  it('follows rebinding', () => {
    const rebound = { ...bindings, reset: ['x'] }
    expect(miniKey(rebound, key('x'), 'other')).toBe('reset')
    expect(miniKey(rebound, key('r'), 'other')).toBeNull()
  })
})
