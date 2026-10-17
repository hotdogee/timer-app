import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  MAX_TIMEOUT_MS,
  WAKE_FIRE,
  connectWakeWorker,
  createWakeTimer,
  parseWakeRequest,
  type TimerApi,
  type WakeWorkerScope,
} from './wake-timer'

const BASE = Date.UTC(2030, 0, 1, 9, 30)

beforeEach(() => {
  vi.useFakeTimers({ now: BASE })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createWakeTimer', () => {
  it('fires once when the clock reaches the deadline, not before', () => {
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire })
    timer.set(BASE + 5000)
    expect(timer.at).toBe(BASE + 5000)
    vi.advanceTimersByTime(4999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(timer.at).toBeNull()
    vi.advanceTimersByTime(60_000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('fires a past deadline on the next turn, never synchronously', () => {
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire })
    timer.set(BASE - 1000)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('replaces the deadline when set again, keeping one timeout', () => {
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire })
    timer.set(BASE + 1000)
    timer.set(BASE + 3000)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(2000)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('moves an earlier deadline forward', () => {
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire })
    timer.set(BASE + 3000)
    timer.set(BASE + 1000)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('cancels on null and on non-finite deadlines', () => {
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire })
    for (const at of [null, Number.NaN, Infinity, -Infinity]) {
      timer.set(BASE + 1000)
      timer.set(at)
      expect(timer.at).toBeNull()
      expect(vi.getTimerCount()).toBe(0)
    }
    vi.advanceTimersByTime(5000)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('splits a delay longer than setTimeout allows and still fires on time', () => {
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire })
    const at = BASE + MAX_TIMEOUT_MS + 10_000
    timer.set(at)
    vi.advanceTimersByTime(MAX_TIMEOUT_MS)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(9_999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('re-arms instead of firing when the timeout runs before the clock reaches the deadline', () => {
    let lag = 0
    const onFire = vi.fn()
    const timer = createWakeTimer({ onFire, now: () => Date.now() - lag })
    timer.set(BASE + 1000)
    // The clock is set back 300 ms after arming, so the timeout runs early by the clock.
    lag = 300
    vi.advanceTimersByTime(1000)
    expect(onFire).not.toHaveBeenCalled()
    expect(timer.at).toBe(BASE + 1000)
    vi.advanceTimersByTime(299)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('uses injected timers', () => {
    const calls: number[] = []
    const clearTimeout = vi.fn()
    const timers: TimerApi = {
      setTimeout: (_callback, delay) => {
        calls.push(delay)
        return calls.length
      },
      clearTimeout,
    }
    const timer = createWakeTimer({ onFire: vi.fn(), timers, now: () => 1000 })
    timer.set(1250)
    timer.set(null)
    expect(calls).toEqual([250])
    expect(clearTimeout).toHaveBeenCalledWith(1)
  })

  it('can be set again from inside onFire', () => {
    let fires = 0
    const timer = createWakeTimer({
      onFire: () => {
        fires += 1
        if (fires === 1) timer.set(Date.now() + 1000)
      },
    })
    timer.set(BASE + 1000)
    vi.advanceTimersByTime(2000)
    expect(fires).toBe(2)
  })
})

describe('parseWakeRequest', () => {
  it('reads a finite deadline or null', () => {
    expect(parseWakeRequest({ at: 123 })).toBe(123)
    expect(parseWakeRequest({ at: null })).toBeNull()
  })

  it('rejects anything else', () => {
    for (const data of [
      undefined,
      null,
      42,
      'fire',
      {},
      { at: '123' },
      { at: Number.NaN },
      { at: Infinity },
      { at: undefined },
    ]) {
      expect(parseWakeRequest(data)).toBeUndefined()
    }
  })
})

/** A worker global scope played by hand: `receive` delivers a message from the page. */
function fakeScope(): WakeWorkerScope & { posted: unknown[]; receive(data: unknown): void } {
  const listeners: ((event: { readonly data: unknown }) => void)[] = []
  const posted: unknown[] = []
  return {
    posted,
    addEventListener(_type, listener) {
      listeners.push(listener)
    },
    postMessage(message) {
      posted.push(message)
    },
    receive(data) {
      for (const listener of listeners) listener({ data })
    },
  }
}

describe('connectWakeWorker', () => {
  it('posts fire when the requested deadline passes', () => {
    const scope = fakeScope()
    connectWakeWorker(scope)
    scope.receive({ at: BASE + 2000 })
    vi.advanceTimersByTime(1999)
    expect(scope.posted).toEqual([])
    vi.advanceTimersByTime(1)
    expect(scope.posted).toEqual([WAKE_FIRE])
  })

  it('cancels on { at: null } and follows the latest request', () => {
    const scope = fakeScope()
    connectWakeWorker(scope)
    scope.receive({ at: BASE + 1000 })
    scope.receive({ at: null })
    vi.advanceTimersByTime(5000)
    expect(scope.posted).toEqual([])
    scope.receive({ at: BASE + 6000 })
    scope.receive({ at: BASE + 8000 })
    vi.advanceTimersByTime(1000)
    expect(scope.posted).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(scope.posted).toEqual([WAKE_FIRE])
  })

  it('ignores malformed messages and keeps the current deadline', () => {
    const scope = fakeScope()
    const timer = connectWakeWorker(scope)
    scope.receive({ at: BASE + 1000 })
    scope.receive('junk')
    scope.receive({ at: 'soon' })
    expect(timer.at).toBe(BASE + 1000)
    vi.advanceTimersByTime(1000)
    expect(scope.posted).toEqual([WAKE_FIRE])
  })
})
