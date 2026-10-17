import { afterEach, describe, expect, it } from 'vitest'

import { cards, stopwatch, timer } from '../../core'
import { setAppLocale } from '../../i18n'
import { describeChanges, joinAnnouncements } from './announcements'

const tea = cards.createTimerCard('t', 'Tea', 0, 180_000)
const lap = cards.createStopwatchCard('s', 'Run', 0)
const base = cards.addCard(cards.addCard(cards.EMPTY_LIST, tea), lap)

function withTimer(list: cards.CardList, update: (t: typeof tea.timer) => typeof tea.timer) {
  return cards.updateTimer(list, 't', update)
}

function withStopwatch(
  list: cards.CardList,
  update: (s: typeof lap.stopwatch) => typeof lap.stopwatch,
) {
  return cards.updateStopwatch(list, 's', update)
}

describe('describeChanges', () => {
  it('says nothing for the same list', () => {
    expect(describeChanges(base, base)).toEqual([])
  })

  it('announces added cards by name', () => {
    const more = cards.addCard(base, cards.createTimerCard('t2', 'Timer 2', 0))
    expect(describeChanges(base, more)).toEqual(['Added Timer 2'])
    expect(describeChanges(cards.EMPTY_LIST, base)).toEqual(['Added Tea', 'Added Run'])
  })

  it('announces a restored card as restored', () => {
    const removed = cards.removeCard(base, 't')
    expect(describeChanges(removed, base, 't')).toEqual(['Restored Tea'])
  })

  it('does not announce deletes (the app does, with the undo hint)', () => {
    expect(describeChanges(base, cards.removeCard(base, 't'))).toEqual([])
  })

  it('announces timer start, pause, resume, time up, dismiss, restart and reset, with the time', () => {
    const running = withTimer(base, (t) => timer.start(t, 0))
    expect(describeChanges(base, running)).toEqual(['Tea started, 3:00'])
    const paused = withTimer(running, (t) => timer.pause(t, 1_500))
    expect(describeChanges(running, paused)).toEqual(['Tea paused, 2:59'])
    const resumed = withTimer(paused, (t) => timer.start(t, 2_000))
    expect(describeChanges(paused, resumed)).toEqual(['Tea resumed, 2:59'])
    const ringing = cards.settleAll(resumed, 1_000_000)
    expect(describeChanges(resumed, ringing)).toEqual(["Tea: time's up"])
    expect(describeChanges(ringing, withTimer(ringing, timer.dismiss))).toEqual(['Tea dismissed'])
    const restarted = withTimer(ringing, (t) => timer.restart(t, 1_000_001))
    expect(describeChanges(ringing, restarted)).toEqual(['Tea restarted, 3:00'])
    expect(describeChanges(paused, withTimer(paused, timer.reset))).toEqual(['Tea reset'])
  })

  it('announces stopwatch start, pause, resume and reset', () => {
    const running = withStopwatch(base, (s) => stopwatch.start(s, 0))
    expect(describeChanges(base, running)).toEqual(['Run started'])
    const paused = withStopwatch(running, (s) => stopwatch.pause(s, 1_530))
    expect(describeChanges(running, paused)).toEqual(['Run paused, 1.53'])
    const resumed = withStopwatch(paused, (s) => stopwatch.start(s, 900))
    expect(describeChanges(paused, resumed)).toEqual(['Run resumed'])
    expect(describeChanges(paused, withStopwatch(paused, stopwatch.reset))).toEqual(['Run reset'])
  })

  it('says nothing for laps, duration changes, renames, mute and selection', () => {
    const running = withStopwatch(base, (s) => stopwatch.start(s, 0))
    expect(
      describeChanges(
        running,
        withStopwatch(running, (s) => stopwatch.lap(s, 10)),
      ),
    ).toEqual([])
    expect(
      describeChanges(
        base,
        withTimer(base, (t) => timer.addTime(t, 30_000, 0)),
      ),
    ).toEqual([])
    expect(describeChanges(base, cards.renameCard(base, 't', 'Green tea'))).toEqual([])
    expect(describeChanges(base, cards.setMuted(base, 't', true))).toEqual([])
    expect(describeChanges(base, cards.selectCard(base, 't'))).toEqual([])
  })

  it('announces a move with the moved card and its new position', () => {
    const three = cards.addCard(base, cards.createTimerCard('e', 'Eggs', 0))
    // Eggs (selected) moves to the front: every card shifts, Eggs furthest.
    expect(describeChanges(three, cards.moveCard(three, 'e', 0))).toEqual([
      'Moved Eggs to position 1 of 3',
    ])
    // A swap of neighbours: the selected card is the one that moved.
    const teaSelected = cards.selectCard(three, 't')
    expect(describeChanges(teaSelected, cards.moveCard(teaSelected, 't', 1))).toEqual([
      'Moved Tea to position 2 of 3',
    ])
    const runSelected = cards.selectCard(three, 's')
    expect(describeChanges(runSelected, cards.moveCard(runSelected, 's', 0))).toEqual([
      'Moved Run to position 1 of 3',
    ])
  })

  it('lists several changes in card order', () => {
    const both = withStopwatch(
      withTimer(base, (t) => timer.start(t, 0)),
      (s) => stopwatch.start(s, 0),
    )
    expect(describeChanges(base, both)).toEqual(['Tea started, 3:00', 'Run started'])
  })
})

describe('describeChanges in other locales', () => {
  afterEach(() => {
    setAppLocale('en')
  })

  it('speaks Japanese', () => {
    setAppLocale('ja')
    const running = withTimer(base, (t) => timer.start(t, 0))
    expect(describeChanges(base, running)).toEqual(['「Tea」を開始しました（3:00）'])
    const ringing = cards.settleAll(running, 1_000_000)
    expect(describeChanges(running, ringing)).toEqual(['「Tea」の時間です'])
    const three = cards.addCard(base, cards.createTimerCard('e', 'Eggs', 0))
    expect(describeChanges(three, cards.moveCard(three, 'e', 0))).toEqual([
      '「Eggs」を 3 件中 1 番目に移動しました',
    ])
  })

  it('speaks Traditional Chinese', () => {
    setAppLocale('zh-TW')
    const paused = withStopwatch(
      withStopwatch(base, (s) => stopwatch.start(s, 0)),
      (s) => stopwatch.pause(s, 1_530),
    )
    expect(describeChanges(base, paused)).toEqual(['「Run」已暫停，1.53'])
    expect(describeChanges(cards.removeCard(base, 't'), base, 't')).toEqual(['已還原「Tea」'])
  })
})

describe('joinAnnouncements', () => {
  afterEach(() => {
    setAppLocale('en')
  })

  it('joins announcements into one utterance with the locale’s sentence break', () => {
    expect(joinAnnouncements([])).toBe('')
    expect(joinAnnouncements(['Tea started, 3:00'])).toBe('Tea started, 3:00')
    expect(joinAnnouncements(['A', 'B', 'C'])).toBe('A. B. C')
    setAppLocale('ja')
    expect(joinAnnouncements(['A', 'B'])).toBe('A。B')
  })
})
