import { describe, expect, it, vi } from 'vitest'

import { cards, timer, type EpochMs, type TimerState } from '../core'
import { setAppLocale } from '../i18n'
import type {
  AlarmPlayer,
  NotificationRequest,
  Notifier,
  PlayOptions,
  SoundId,
  WakeScheduler,
} from '../platform'
import {
  DEFAULT_ALARM_SETTINGS,
  autoStopAt,
  createAlarmCore,
  timerStarted,
  type AlarmPlatform,
  type AlarmSettings,
} from './alarm.svelte'

function fakePlatform(permission: ReturnType<Notifier['permission']> = 'granted') {
  const played: { sound: SoundId; options: PlayOptions }[] = []
  let stops = 0
  let unlocks = 0
  const audio: AlarmPlayer = {
    unlock: () => {
      unlocks++
    },
    play: (sound, options) => {
      played.push({ sound, options })
    },
    stop: () => {
      stops++
    },
    playing: false,
    preview: () => undefined,
  }

  const shown: (NotificationRequest & { closed: boolean })[] = []
  let requests = 0
  const notifications: Notifier = {
    supported: true,
    permission: () => permission,
    request: () => {
      requests++
      return Promise.resolve(true)
    },
    show: (n) => {
      if (permission !== 'granted') return null
      const entry = { ...n, closed: false }
      shown.push(entry)
      return {
        close: () => {
          entry.closed = true
        },
      }
    },
  }

  const scheduled: (EpochMs | null)[] = []
  let onFire: (() => void) | null = null
  const wake: WakeScheduler = {
    schedule: (at, fire) => {
      scheduled.push(at)
      onFire = at === null ? null : fire
    },
  }

  const platform: AlarmPlatform = { audio, notifications, wake }
  return {
    platform,
    played,
    shown,
    scheduled,
    get stops() {
      return stops
    },
    get unlocks() {
      return unlocks
    },
    get requests() {
      return requests
    },
    fire() {
      onFire?.()
    },
  }
}

function fakeStore() {
  const settled: EpochMs[] = []
  const actions: { id: string; result: TimerState }[] = []
  return {
    settled,
    actions,
    store: {
      settle: (now: EpochMs) => {
        settled.push(now)
      },
      timer: (id: string, update: (t: TimerState, now: EpochMs) => TimerState) => {
        actions.push({ id, result: update({ phase: 'ringing', duration: 1000, endedAt: 0 }, 5) })
      },
    },
  }
}

const idleA = cards.createTimerCard('a', 'Tea', 0, 60_000)
const idleB = cards.createTimerCard('b', 'Eggs', 0, 120_000)
const watch = cards.createStopwatchCard('s', 'Run', 0)
const base = [idleA, idleB, watch].reduce(cards.addCard, cards.EMPTY_LIST)

function run(list: cards.CardList, id: string, at: EpochMs): cards.CardList {
  return cards.updateTimer(list, id, (t) => timer.start(t, at))
}

describe('createAlarmCore', () => {
  it('plays the default sound looping at the default volume while an unmuted timer rings', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    core.sync(base)
    expect(p.played).toEqual([])
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(ringing)
    expect(p.played).toEqual([{ sound: 'chime', options: { loop: true, volume: 0.8 } }])
  })

  it('plays once for several ringing cards and stops only when none rings', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    const both = cards.settleAll(run(run(base, 'a', 0), 'b', 0), 200_000)
    core.sync(both)
    const oneLeft = cards.updateTimer(both, 'a', timer.dismiss)
    core.sync(oneLeft)
    expect(p.played).toHaveLength(1)
    expect(p.stops).toBe(0)
    core.sync(cards.updateTimer(oneLeft, 'b', timer.dismiss))
    expect(p.stops).toBe(1)
  })

  it('stays silent for a muted ringing card and stops when the ringing card is muted', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(cards.setMuted(ringing, 'a', true))
    expect(p.played).toEqual([])
    core.sync(ringing)
    expect(p.played).toHaveLength(1)
    core.sync(cards.setMuted(ringing, 'a', true))
    expect(p.stops).toBe(1)
  })

  it('stops the sound when the ringing card is deleted', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(ringing)
    core.sync(cards.removeCard(ringing, 'a'))
    expect(p.stops).toBe(1)
  })

  it('uses the configured sound and volume', () => {
    const p = fakePlatform()
    const settings = { ...DEFAULT_ALARM_SETTINGS, sound: 'bell', volume: 0.3 } as const
    const core = createAlarmCore(fakeStore().store, p.platform, { settings: () => settings })
    core.sync(cards.settleAll(run(base, 'a', 0), 60_000))
    expect(p.played).toEqual([{ sound: 'bell', options: { loop: true, volume: 0.3 } }])
  })

  it('shows one notification per card when it starts ringing, also for muted cards', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(ringing)
    core.sync(cards.setMuted(ringing, 'a', true))
    expect(p.shown).toHaveLength(1)
    expect(p.shown[0]).toMatchObject({
      title: 'Tea',
      body: "Time's up",
      tag: 'a',
      requireInteraction: true,
      closed: false,
    })
  })

  it('writes the notification body in the active locale', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    setAppLocale('ja')
    try {
      core.sync(cards.settleAll(run(base, 'a', 0), 60_000))
    } finally {
      setAppLocale('en')
    }
    expect(p.shown[0]).toMatchObject({ title: 'Tea', body: '時間です' })
  })

  it('closes the notification when the card stops ringing and notifies again next time', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(ringing)
    const dismissed = cards.updateTimer(ringing, 'a', timer.dismiss)
    core.sync(dismissed)
    expect(p.shown[0]?.closed).toBe(true)
    core.sync(cards.settleAll(run(dismissed, 'a', 100_000), 200_000))
    expect(p.shown).toHaveLength(2)
    expect(p.shown[1]?.closed).toBe(false)
  })

  it('closes the notification of a deleted ringing card', () => {
    const p = fakePlatform()
    const core = createAlarmCore(fakeStore().store, p.platform)
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(ringing)
    core.sync(cards.removeCard(ringing, 'a'))
    expect(p.shown[0]?.closed).toBe(true)
  })

  it('does not retry a notification the platform refused while the card keeps ringing', () => {
    const p = fakePlatform('denied')
    const show = vi.spyOn(p.platform.notifications, 'show')
    const core = createAlarmCore(fakeStore().store, p.platform)
    const ringing = cards.settleAll(run(base, 'a', 0), 60_000)
    core.sync(ringing)
    core.sync(cards.setMuted(ringing, 'a', true))
    expect(show).toHaveBeenCalledTimes(1)
  })

  it('dismisses the card when its notification is clicked', () => {
    const p = fakePlatform()
    const s = fakeStore()
    const core = createAlarmCore(s.store, p.platform)
    core.sync(cards.settleAll(run(base, 'a', 0), 60_000))
    p.shown[0]?.onClick?.()
    expect(s.actions).toEqual([{ id: 'a', result: { phase: 'idle', duration: 1000 } }])
  })

  it('schedules a wake-up at the earliest running deadline and settles at a fresh now', () => {
    const p = fakePlatform()
    const s = fakeStore()
    const core = createAlarmCore(s.store, p.platform, { bump: () => 42 })
    core.sync(base)
    expect(p.scheduled.at(-1)).toBeNull()
    core.sync(run(run(base, 'a', 1_000), 'b', 0))
    expect(p.scheduled.at(-1)).toBe(61_000)
    p.fire()
    expect(s.settled).toEqual([42])
  })

  it('unlocks audio and asks for notification permission once on prime', () => {
    const p = fakePlatform('default')
    const core = createAlarmCore(fakeStore().store, p.platform)
    core.prime()
    core.prime()
    expect(p.unlocks).toBe(2)
    expect(p.requests).toBe(1)
  })

  it('does not ask for permission that is already decided', () => {
    const p = fakePlatform('denied')
    const core = createAlarmCore(fakeStore().store, p.platform)
    core.prime()
    expect(p.requests).toBe(0)
  })

  it('asks for permission when a timer starts without prime (keyboard, palette)', () => {
    const p = fakePlatform('default')
    const core = createAlarmCore(fakeStore().store, p.platform)
    core.sync(base)
    expect(p.requests).toBe(0)
    core.sync(run(base, 'a', 0))
    expect(p.requests).toBe(1)
    core.sync(run(run(base, 'a', 0), 'b', 0))
    expect(p.requests).toBe(1)
  })

  it('does not ask for permission for timers already running on the first sync', () => {
    const p = fakePlatform('default')
    const core = createAlarmCore(fakeStore().store, p.platform)
    core.sync(run(base, 'a', 0))
    expect(p.requests).toBe(0)
  })

  it('undoes everything on dispose and ignores later calls', () => {
    const p = fakePlatform()
    const s = fakeStore()
    const core = createAlarmCore(s.store, p.platform)
    const ringing = cards.settleAll(run(run(base, 'a', 0), 'b', 0), 60_000)
    core.sync(ringing)
    core.dispose()
    expect(p.stops).toBe(1)
    expect(p.shown[0]?.closed).toBe(true)
    expect(p.scheduled.at(-1)).toBeNull()
    core.sync(cards.settleAll(ringing, 500_000))
    core.prime()
    core.dispose()
    expect(p.played).toHaveLength(1)
    expect(p.unlocks).toBe(0)
    expect(p.stops).toBe(1)
  })
})

/** An alarm core whose settings and clock the test changes. */
function withSettings(initial: Partial<AlarmSettings> = {}, permission?: 'granted' | 'default') {
  const p = fakePlatform(permission)
  const s = fakeStore()
  let settings: AlarmSettings = { ...DEFAULT_ALARM_SETTINGS, ...initial }
  let now: EpochMs = 0
  const core = createAlarmCore(s.store, p.platform, {
    settings: () => settings,
    clock: () => now,
    bump: () => now,
  })
  return {
    p,
    s,
    core,
    set(partial: Partial<AlarmSettings>) {
      settings = { ...settings, ...partial }
    },
    at(time: EpochMs) {
      now = time
    },
  }
}

/** Timer 'a' (1:00) started at 0, so ringing from 60 000. */
function ringingList(): cards.CardList {
  return cards.settleAll(run(base, 'a', 0), 60_000)
}

describe('alarm settings', () => {
  it('plays once per card that starts ringing when loop is off', () => {
    const a = withSettings({ loop: false })
    a.at(60_000)
    // 'a' rings from 60 000; 'b' (2:00, started at 30 000) from 150 000.
    const first = cards.settleAll(run(run(base, 'a', 0), 'b', 30_000), 60_000)
    a.core.sync(first)
    expect(a.p.played).toEqual([{ sound: 'chime', options: { loop: false, volume: 0.8 } }])
    a.core.sync(cards.renameCard(first, 'a', 'Green tea'))
    expect(a.p.played).toHaveLength(1)
    a.at(150_000)
    const second = cards.settleAll(first, 150_000)
    a.core.sync(second)
    expect(a.p.played).toHaveLength(2)
    const oneLeft = cards.updateTimer(second, 'a', timer.dismiss)
    a.core.sync(oneLeft)
    expect(a.p.played).toHaveLength(2)
    expect(a.p.stops).toBe(0)
    a.core.sync(cards.updateTimer(oneLeft, 'b', timer.dismiss))
    expect(a.p.stops).toBe(1)
  })

  it('plays once again for a card that rings again after a dismiss', () => {
    const a = withSettings({ loop: false })
    a.at(60_000)
    const ringing = ringingList()
    a.core.sync(ringing)
    const dismissed = cards.updateTimer(ringing, 'a', timer.dismiss)
    a.core.sync(dismissed)
    a.at(200_000)
    a.core.sync(cards.settleAll(run(dismissed, 'a', 100_000), 200_000))
    expect(a.p.played).toHaveLength(2)
  })

  it('follows a new sound or volume while ringing, and ignores unrelated syncs', () => {
    const a = withSettings()
    a.at(60_000)
    const ringing = ringingList()
    a.core.sync(ringing)
    a.core.sync(ringing)
    expect(a.p.played).toHaveLength(1)
    a.set({ volume: 0.4 })
    a.core.sync(ringing)
    a.set({ sound: 'beep' })
    a.core.sync(ringing)
    expect(a.p.played).toEqual([
      { sound: 'chime', options: { loop: true, volume: 0.8 } },
      { sound: 'chime', options: { loop: true, volume: 0.4 } },
      { sound: 'beep', options: { loop: true, volume: 0.4 } },
    ])
  })

  it('stops the loop when loop is turned off while ringing, and starts it when turned on', () => {
    const a = withSettings()
    a.at(60_000)
    const ringing = ringingList()
    a.core.sync(ringing)
    a.set({ loop: false })
    a.core.sync(ringing)
    expect(a.p.stops).toBe(1)
    expect(a.p.played).toHaveLength(1)
    a.set({ loop: true })
    a.core.sync(ringing)
    expect(a.p.played.at(-1)).toEqual({ sound: 'chime', options: { loop: true, volume: 0.8 } })
  })

  it('goes quiet autoStopMinutes after a card started ringing, leaving the card ringing', () => {
    const a = withSettings({ autoStopMinutes: 2 })
    a.at(90_000)
    const ringing = ringingList()
    a.core.sync(ringing)
    expect(a.p.played).toHaveLength(1)
    expect(a.p.shown).toHaveLength(1)
    // The wake-up comes at the auto-stop: ringing since 60 000, plus two minutes.
    expect(a.p.scheduled.at(-1)).toBe(180_000)
    a.at(180_000)
    a.p.fire()
    expect(a.s.settled).toEqual([180_000])
    expect(a.p.stops).toBe(1)
    expect(a.p.shown[0]?.closed).toBe(true)
    expect(a.p.scheduled.at(-1)).toBeNull()
    // Still ringing: no new sound or notification on later syncs.
    a.core.sync(cards.renameCard(ringing, 'a', 'Green tea'))
    a.at(500_000)
    a.core.sync(ringing)
    expect(a.p.played).toHaveLength(1)
    expect(a.p.shown).toHaveLength(1)
  })

  it('keeps sounding while another card is before its auto-stop', () => {
    const a = withSettings({ autoStopMinutes: 1 })
    a.at(130_000)
    // 'a' rings from 60 000 (quiet at 120 000), 'b' from 120 000 (quiet at 180 000).
    a.core.sync(cards.settleAll(run(run(base, 'a', 0), 'b', 0), 130_000))
    expect(a.p.played).toHaveLength(1)
    expect(a.p.shown.map((n) => n.tag)).toEqual(['b'])
    expect(a.p.scheduled.at(-1)).toBe(180_000)
  })

  it('stays silent for a timer that ended longer ago than the auto-stop (closed app)', () => {
    const a = withSettings({ autoStopMinutes: 5 })
    a.at(60_000 + 6 * 60_000)
    a.core.sync(ringingList())
    expect(a.p.played).toEqual([])
    expect(a.p.shown).toEqual([])
    expect(a.p.scheduled.at(-1)).toBeNull()
  })

  it('sounds again when auto-stop is turned off for a quiet ringing card', () => {
    const a = withSettings({ autoStopMinutes: 1 })
    a.at(200_000)
    const ringing = ringingList()
    a.core.sync(ringing)
    expect(a.p.played).toEqual([])
    a.set({ autoStopMinutes: 0 })
    a.core.sync(ringing)
    expect(a.p.played).toHaveLength(1)
  })

  it('shows no notifications while they are off, and closes those on screen', () => {
    const a = withSettings({ notifications: false })
    a.at(60_000)
    const ringing = ringingList()
    a.core.sync(ringing)
    expect(a.p.shown).toEqual([])
    expect(a.p.played).toHaveLength(1)
    a.set({ notifications: true })
    a.core.sync(ringing)
    expect(a.p.shown).toHaveLength(1)
    a.set({ notifications: false })
    a.core.sync(ringing)
    expect(a.p.shown[0]?.closed).toBe(true)
    a.core.sync(ringing)
    expect(a.p.shown).toHaveLength(1)
  })

  it('does not ask for notification permission while notifications are off', () => {
    const a = withSettings({ notifications: false }, 'default')
    a.core.prime()
    a.core.sync(base)
    a.core.sync(run(base, 'a', 0))
    expect(a.p.requests).toBe(0)
    a.set({ notifications: true })
    a.core.prime()
    expect(a.p.requests).toBe(1)
  })

  it('wakes at the earlier of the next running deadline and the next auto-stop', () => {
    const a = withSettings({ autoStopMinutes: 3 })
    a.at(60_000)
    // 'a' rings from 60 000 (quiet at 240 000); 'b' (2:00) started at 30 000 ends at 150 000.
    const both = run(ringingList(), 'b', 30_000)
    a.core.sync(both)
    expect(a.p.scheduled.at(-1)).toBe(150_000)
    a.core.sync(cards.updateTimer(both, 'b', timer.reset))
    expect(a.p.scheduled.at(-1)).toBe(240_000)
  })
})

describe('autoStopAt', () => {
  it('is autoStopMinutes after the end, or never for 0 and bad values', () => {
    expect(autoStopAt(1_000, 2)).toBe(121_000)
    expect(autoStopAt(1_000, 0)).toBe(Number.POSITIVE_INFINITY)
    expect(autoStopAt(1_000, -1)).toBe(Number.POSITIVE_INFINITY)
    expect(autoStopAt(1_000, Number.NaN)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('timerStarted', () => {
  it('is true when a timer went to running', () => {
    expect(timerStarted(base, run(base, 'a', 0))).toBe(true)
  })

  it('is true for a new card that is already running', () => {
    const list = run(cards.addCard(base, cards.createTimerCard('c', 'New', 0)), 'c', 0)
    expect(timerStarted(base, list)).toBe(true)
  })

  it('is false when nothing new runs', () => {
    const running = run(base, 'a', 0)
    expect(timerStarted(running, running)).toBe(false)
    expect(
      timerStarted(
        running,
        cards.updateTimer(running, 'a', (t) => timer.pause(t, 5)),
      ),
    ).toBe(false)
    expect(timerStarted(base, cards.renameCard(base, 'a', 'Green tea'))).toBe(false)
  })
})
