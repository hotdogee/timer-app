import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cards, timer, type TimerState } from '../core'
import type { AlarmPlatform } from './alarm.svelte'
import { createAlarmCore } from './alarm.svelte'
import { appClock, clockOffset, onClockOffsetChange, setClockOffset } from './app-clock'
import { cardStore } from './cards.svelte'
import { createFrameClock, frameClock } from '../ui/frame-clock.svelte'

/** 14:47 UTC on 2026-10-18. */
const BASE = Date.UTC(2026, 9, 18, 14, 47, 0)

beforeEach(() => {
  vi.useFakeTimers({ now: BASE })
})

afterEach(() => {
  setClockOffset(0)
  vi.useRealTimers()
})

describe('appClock', () => {
  it('is the device clock while there is no offset', () => {
    expect(clockOffset()).toBe(0)
    expect(appClock()).toBe(BASE)
    vi.advanceTimersByTime(1234)
    expect(appClock()).toBe(BASE + 1234)
  })

  it('adds the offset, reading the device clock on every call', () => {
    setClockOffset(5000)
    expect(clockOffset()).toBe(5000)
    expect(appClock()).toBe(BASE + 5000)
    vi.advanceTimersByTime(10)
    expect(appClock()).toBe(BASE + 5010)
    setClockOffset(-2500)
    expect(appClock()).toBe(BASE + 10 - 2500)
  })

  it('rounds the offset to whole milliseconds and treats a non-finite one as 0', () => {
    setClockOffset(1234.6)
    expect(clockOffset()).toBe(1235)
    expect(appClock()).toBe(BASE + 1235)
    setClockOffset(Number.NaN)
    expect(clockOffset()).toBe(0)
    setClockOffset(400)
    setClockOffset(Number.POSITIVE_INFINITY)
    expect(clockOffset()).toBe(0)
    expect(appClock()).toBe(BASE)
  })

  it('folds a negative zero into zero', () => {
    setClockOffset(-0.2)
    expect(Object.is(clockOffset(), 0)).toBe(true)
  })
})

describe('onClockOffsetChange', () => {
  it('tells listeners about each change, after the clock already reads it', () => {
    const seen: number[] = []
    const stop = onClockOffsetChange(() => {
      seen.push(appClock() - BASE)
    })
    setClockOffset(300)
    setClockOffset(300)
    setClockOffset(300.2)
    setClockOffset(-300)
    setClockOffset(0)
    expect(seen).toEqual([300, -300, 0])
    stop()
    setClockOffset(900)
    expect(seen).toEqual([300, -300, 0])
  })

  it('lets a listener unsubscribe while being called', () => {
    const second = vi.fn()
    const stop = onClockOffsetChange(() => {
      stop()
    })
    const stopSecond = onClockOffsetChange(second)
    setClockOffset(1000)
    setClockOffset(2000)
    expect(second).toHaveBeenCalledTimes(2)
    stopSecond()
  })
})

describe('the app reads time through the app clock', () => {
  it('frame clocks default to it, and the app frame clock reads the offset on bump', () => {
    setClockOffset(7000)
    expect(createFrameClock().now).toBe(BASE + 7000)
    frameClock.bump()
    expect(frameClock.now).toBe(BASE + 7000)
    setClockOffset(-1500)
    frameClock.bump()
    expect(frameClock.now).toBe(BASE - 1500)
  })

  it('the card store stamps new cards and times actions with it', () => {
    setClockOffset(60_000)
    const id = cardStore.addTimer(5 * 60_000)
    const added = cards.findCard(cardStore.list, id)
    expect(added?.createdAt).toBe(BASE + 60_000)
    cardStore.timer(id, timer.start)
    const card = cards.findCard(cardStore.list, id)
    const state = card?.kind === 'timer' ? card.timer : undefined
    expect(state).toEqual<TimerState>({
      phase: 'running',
      duration: 5 * 60_000,
      endsAt: BASE + 60_000 + 5 * 60_000,
    })
    cardStore.remove(id)
    cardStore.forgetRemoved()
  })

  it('the alarm times auto-stop with it', () => {
    const played: unknown[] = []
    const scheduled: (number | null)[] = []
    const platform: AlarmPlatform = {
      audio: {
        unlock: () => undefined,
        play: (sound) => {
          played.push(sound)
        },
        stop: () => undefined,
        playing: false,
        preview: () => undefined,
      },
      notifications: {
        supported: false,
        permission: () => 'denied',
        request: () => Promise.resolve(false),
        show: () => null,
      },
      wake: {
        schedule: (at) => {
          scheduled.push(at)
        },
      },
    }
    const core = createAlarmCore({ settle: () => undefined, timer: () => undefined }, platform, {
      settings: () => ({
        sound: 'chime',
        volume: 1,
        loop: true,
        autoStopMinutes: 1,
        notifications: false,
      }),
      bump: () => appClock(),
      gestureTarget: null,
    })
    // Rang 61 s ago in app time: past its one-minute auto-stop only once the offset applies.
    const list = cards.addCard(cards.EMPTY_LIST, {
      id: 'a',
      kind: 'timer',
      name: 'Tea',
      createdAt: BASE,
      muted: false,
      timer: { phase: 'ringing', duration: 1000, endedAt: BASE - 1000 },
    })
    core.sync(list)
    expect(played).toEqual(['chime'])
    expect(scheduled.at(-1)).toBe(BASE - 1000 + 60_000)
    setClockOffset(60_000)
    core.sync(list)
    expect(scheduled.at(-1)).toBeNull()
    core.dispose()
  })
})
