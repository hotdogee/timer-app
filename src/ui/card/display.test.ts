import { describe, expect, it } from 'vitest'

import { cards, digits, stopwatch, timer } from '../../core'
import {
  cardStatus,
  DOT_PERIOD,
  MINUS,
  QUICK_ADD,
  dotTurn,
  isRewind,
  overtimeText,
  quickAddLabel,
  timerView,
} from './display'

describe('timerView', () => {
  const idle = timer.createTimer(300_000)
  const running = timer.start(idle, 1_000)
  const paused = timer.pause(running, 2_000)
  const ringing = timer.settle(running, 400_000)

  it('shows the phase when nothing is typed', () => {
    expect(timerView(idle, digits.EMPTY)).toBe('idle')
    expect(timerView(running, digits.EMPTY)).toBe('running')
    expect(timerView(paused, digits.EMPTY)).toBe('paused')
    expect(timerView(ringing, digits.EMPTY)).toBe('ringing')
  })

  it('shows the typed digits on idle, paused and ringing timers', () => {
    expect(timerView(idle, '90')).toBe('typing')
    expect(timerView(paused, '1')).toBe('typing')
    expect(timerView(ringing, '13030')).toBe('typing')
  })

  it('ignores typed digits on a running timer', () => {
    expect(timerView(running, '90')).toBe('running')
  })
})

describe('quick-add chips', () => {
  it('are +0:30, +1:00 and +5:00', () => {
    expect(QUICK_ADD.map(quickAddLabel)).toEqual(['+0:30', '+1:00', '+5:00'])
  })
})

describe('overtimeText', () => {
  it('uses U+2212 instead of the hyphen-minus', () => {
    expect(overtimeText(12_000)).toBe(`${MINUS}0:12`)
    expect(overtimeText(3_661_000)).toBe(`${MINUS}1:01:01`)
  })

  it('shows 0:00 without a sign for the first second', () => {
    expect(overtimeText(0)).toBe('0:00')
    expect(overtimeText(999)).toBe('0:00')
  })

  it('never contains an ASCII hyphen', () => {
    for (const ms of [0, 1_000, 59_999, 600_000, 36_000_000]) {
      expect(overtimeText(ms)).not.toContain('-')
    }
  })
})

describe('cardStatus', () => {
  it('names the kind and the phase', () => {
    const t = cards.createTimerCard('t', 'Tea', 0)
    expect(cardStatus(t)).toBe('Timer, ready')
    expect(cardStatus({ ...t, timer: timer.start(t.timer, 0) })).toBe('Timer, running')
    expect(cardStatus({ ...t, timer: timer.pause(timer.start(t.timer, 0), 1) })).toBe(
      'Timer, paused',
    )
    expect(cardStatus({ ...t, timer: { phase: 'ringing', duration: 1, endedAt: 1 } })).toBe(
      "Timer, time's up",
    )
    const s = cards.createStopwatchCard('s', 'Run', 0)
    expect(cardStatus(s)).toBe('Stopwatch, ready')
    expect(cardStatus({ ...s, stopwatch: stopwatch.start(s.stopwatch, 0) })).toBe(
      'Stopwatch, running',
    )
  })
})

describe('dotTurn', () => {
  it('starts at 12 o’clock and makes one turn per minute', () => {
    expect(dotTurn(0)).toBe(0)
    expect(dotTurn(15_000)).toBe(0.25)
    expect(dotTurn(30_000)).toBe(0.5)
    expect(dotTurn(DOT_PERIOD)).toBe(0)
    expect(dotTurn(DOT_PERIOD + 45_000)).toBe(0.75)
  })

  it('reads 0 for negative and non-finite input', () => {
    expect(dotTurn(-5)).toBe(0)
    expect(dotTurn(Number.NaN)).toBe(0)
    expect(dotTurn(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('stays in [0, 1)', () => {
    for (let ms = 0; ms < 200_000; ms += 1_237) {
      const turn = dotTurn(ms)
      expect(turn).toBeGreaterThanOrEqual(0)
      expect(turn).toBeLessThan(1)
    }
  })
})

describe('isRewind', () => {
  it('detects backward jumps', () => {
    expect(isRewind(1, 0)).toBe(true)
    expect(isRewind(0.5, 0.4)).toBe(true)
  })

  it('ignores forward motion, no motion and rounding noise', () => {
    expect(isRewind(0.4, 0.5)).toBe(false)
    expect(isRewind(0.4, 0.4)).toBe(false)
    expect(isRewind(0.4, 0.4 - 1e-6)).toBe(false)
  })
})
