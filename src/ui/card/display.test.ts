import { afterEach, describe, expect, it } from 'vitest'

import { cards, digits, formatClockTime, settings, stopwatch, timer } from '../../core'
import { setAppLocale } from '../../i18n'
import {
  cardStatus,
  clockHourCycle,
  clockLocale,
  DOT_PERIOD,
  MINUS,
  dotTurn,
  isRewind,
  overtimeText,
  quickAddLabel,
  timerReadout,
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
  it('are +0:30, +1:00 and +5:00 by default', () => {
    expect(settings.SYNCED_DEFAULTS.quickAdd.map(quickAddLabel)).toEqual([
      '+0:30',
      '+1:00',
      '+5:00',
    ])
  })

  it('label any amount compactly', () => {
    expect([15_000, 90_000, 3_600_000, 86_400_000].map(quickAddLabel)).toEqual([
      '+0:15',
      '+1:30',
      '+1:00:00',
      '+24:00:00',
    ])
  })
})

describe('timerReadout', () => {
  const compact = { style: 'compact', showOvertime: true } as const
  const fixed = { style: 'fixed', showOvertime: true } as const

  it('shows the time left in the time style', () => {
    expect(timerReadout('idle', digits.EMPTY, 300_000, 0, compact)).toBe('5:00')
    expect(timerReadout('idle', digits.EMPTY, 300_000, 0, fixed)).toBe('00:05:00')
    expect(timerReadout('running', digits.EMPTY, 293_000, 0, compact)).toBe('4:53')
    expect(timerReadout('paused', digits.EMPTY, 293_000, 0, fixed)).toBe('00:04:53')
  })

  it('shows typed digits as typed, whatever the style', () => {
    expect(timerReadout('typing', '90', 0, 0, compact)).toBe('00:00:90')
    expect(timerReadout('typing', '90', 0, 0, fixed)).toBe('00:00:90')
  })

  it('counts the overtime while ringing, with a real minus sign', () => {
    expect(timerReadout('ringing', digits.EMPTY, 0, 12_000, compact)).toBe(`${MINUS}0:12`)
    expect(timerReadout('ringing', digits.EMPTY, 0, 12_000, fixed)).toBe(`${MINUS}00:00:12`)
  })

  it('stays at zero while ringing without the overtime counter', () => {
    const off = { style: 'compact', showOvertime: false } as const
    expect(timerReadout('ringing', digits.EMPTY, 0, 12_000, off)).toBe('0:00')
    expect(timerReadout('ringing', digits.EMPTY, 0, 3_600_000, { ...off, style: 'fixed' })).toBe(
      '00:00:00',
    )
    // The setting only concerns ringing timers.
    expect(timerReadout('running', digits.EMPTY, 60_000, 0, off)).toBe('1:00')
  })
})

describe('clockLocale', () => {
  it('uses the browser’s variant of the UI language', () => {
    expect(clockLocale('en', ['en-GB', 'en-US'])).toBe('en-GB')
    expect(clockLocale('en', ['fr-FR', 'en-AU'])).toBe('en-AU')
    expect(clockLocale('zh-TW', ['zh-HK'])).toBe('zh-HK')
    expect(clockLocale('ja', ['ja-JP'])).toBe('ja-JP')
  })

  it('takes the first browser language’s 12/24-hour clock when none is a variant', () => {
    // A German or French browser gets the English UI, but keeps its 24-hour clock.
    expect(clockLocale('en', ['de-DE', 'nl-NL'])).toBe('en-u-hc-h23')
    expect(clockLocale('en', ['fr-FR'])).toBe('en-u-hc-h23')
    expect(clockLocale('ja', ['en-US'])).toBe('ja-u-hc-h12')
    expect(clockLocale('zh-TW', ['zh-CN'])).toBe('zh-TW-u-hc-h23')
  })

  it('falls back to the UI language when the browser says nothing usable', () => {
    expect(clockLocale('en', [])).toBe('en')
    expect(clockLocale('ja', ['not a tag'])).toBe('ja')
  })

  it('gives clock times in the convention of the user’s locale', () => {
    const at = Date.UTC(2026, 9, 17, 14, 47)
    const time = (languages: string[], hourCycle?: 'h12' | 'h23') =>
      formatClockTime(at, { locale: clockLocale('en', languages), hourCycle, timeZone: 'UTC' })
    expect(time(['de-DE'])).toBe('14:47')
    expect(time(['fr-FR'])).toBe('14:47')
    expect(time(['en-US'])).toBe('2:47 PM')
    expect(time(['en-GB'])).toBe('14:47')
    // The 12/24-hour setting still wins.
    expect(time(['de-DE'], 'h12')).toBe('2:47 PM')
  })
})

describe('clockHourCycle', () => {
  it('passes 12 and 24 hours on and leaves auto to the locale', () => {
    expect(clockHourCycle('h12')).toBe('h12')
    expect(clockHourCycle('h23')).toBe('h23')
    expect(clockHourCycle('auto')).toBeUndefined()
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

  it('follows the fixed time style', () => {
    expect(overtimeText(12_000, 'fixed')).toBe(`${MINUS}00:00:12`)
    expect(overtimeText(500, 'fixed')).toBe('00:00:00')
  })

  it('never contains an ASCII hyphen', () => {
    for (const ms of [0, 1_000, 59_999, 600_000, 36_000_000]) {
      expect(overtimeText(ms)).not.toContain('-')
      expect(overtimeText(ms, 'fixed')).not.toContain('-')
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

  describe('in other locales', () => {
    afterEach(() => {
      setAppLocale('en')
    })

    it('uses the locale’s words and punctuation', () => {
      const t = cards.createTimerCard('t', 'Tea', 0)
      const s = cards.createStopwatchCard('s', 'Run', 0)
      setAppLocale('zh-TW')
      expect(cardStatus(t)).toBe('計時器，就緒')
      expect(cardStatus({ ...s, stopwatch: stopwatch.start(s.stopwatch, 0) })).toBe('碼錶，計時中')
      setAppLocale('ja')
      expect(cardStatus({ ...t, timer: { phase: 'ringing', duration: 1, endedAt: 1 } })).toBe(
        'タイマー、時間です',
      )
      expect(cardStatus(s)).toBe('ストップウォッチ、待機中')
    })
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
