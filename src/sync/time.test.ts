import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appClock, clockOffset, setClockOffset } from '../state/app-clock'
import {
  CLOCK_OFFSET_THRESHOLD_MS,
  CLOCK_REMEASURE_INTERVAL_MS,
  CLOCK_SAMPLE_TIMEOUT_MS,
  applicableOffset,
  bestSample,
  clockSync,
  createClockSync,
  measureOffset,
  type FetchLike,
} from './time'

/** 14:47 UTC on 2026-10-18. */
const BASE = Date.UTC(2026, 9, 18, 14, 47, 0)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * A server whose clock is `skew` ms ahead of the device's, answering each request after its
 * scripted round trip: half on the way there (when it reads its clock), half on the way back.
 * `clock` is the device clock, advanced by the fake fetch itself.
 */
function skewedServer(skew: number, roundTrips: readonly number[]) {
  let device = BASE
  const requests: { url: string; init: RequestInit }[] = []
  const clock = (): number => device
  const fetch: FetchLike = (url, init) => {
    const index = requests.length
    requests.push({ url, init })
    const trip = roundTrips[index] ?? 10
    device += trip / 2
    const serverNow = device + skew
    device += trip / 2
    return Promise.resolve(json({ now: serverNow }))
  }
  return { clock, fetch, requests }
}

afterEach(() => {
  setClockOffset(0)
  vi.useRealTimers()
})

describe('measureOffset', () => {
  it('finds the offset of a skewed server clock', async () => {
    const server = skewedServer(4000, [40, 40, 40])
    await expect(measureOffset(server)).resolves.toBe(4000)
    const slow = skewedServer(-1500, [300, 300, 300])
    await expect(measureOffset(slow)).resolves.toBe(-1500)
  })

  it('makes three requests to /api/time, one after another, never cached and without cookies', async () => {
    const server = skewedServer(0, [10, 10, 10])
    let inFlight = 0
    let most = 0
    const fetch: FetchLike = async (url, init) => {
      inFlight++
      most = Math.max(most, inFlight)
      await Promise.resolve()
      const response = await server.fetch(url, init)
      inFlight--
      return response
    }
    await measureOffset({ fetch, clock: server.clock })
    expect(server.requests.map((request) => request.url)).toEqual([
      '/api/time',
      '/api/time',
      '/api/time',
    ])
    expect(most).toBe(1)
    const [first] = server.requests
    expect(first?.init.cache).toBe('no-store')
    expect(first?.init.credentials).toBe('omit')
    expect(first?.init.signal).toBeInstanceOf(AbortSignal)
  })

  it('trusts the sample with the shortest round trip', async () => {
    // An asymmetric first request (DNS, TLS) would skew the answer; the quick one wins.
    let device = BASE
    const answers = [
      { trip: 900, serverAt: 100 }, // the server read its clock 100 ms into a 900 ms trip
      { trip: 20, serverAt: 10 },
      { trip: 60, serverAt: 30 },
    ]
    let index = 0
    const fetch: FetchLike = () => {
      const answer = answers[index++] ?? { trip: 10, serverAt: 5 }
      const serverNow = device + answer.serverAt + 2000
      device += answer.trip
      return Promise.resolve(json({ now: serverNow }))
    }
    await expect(measureOffset({ fetch, clock: () => device })).resolves.toBe(2000)
  })

  it('rounds to whole milliseconds', async () => {
    const server = skewedServer(1000.4, [3, 3, 3])
    await expect(measureOffset(server)).resolves.toBe(1000)
  })

  it('skips samples that fail and resolves to null when every one does', async () => {
    const server = skewedServer(800, [20, 20, 20])
    const failures: (() => Promise<Response>)[] = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => Promise.resolve(json({ error: 'not-found' }, 404)),
    ]
    let calls = 0
    const flaky: FetchLike = (url, init) => {
      const failure = failures[calls++]
      return failure ? failure() : server.fetch(url, init)
    }
    await expect(measureOffset({ fetch: flaky, clock: server.clock })).resolves.toBe(800)

    const bodies: unknown[] = [{ now: 'soon' }, { later: 1 }, null, { now: Number.NaN }]
    let next = 0
    const garbage: FetchLike = () => Promise.resolve(json(bodies[next++] ?? null))
    await expect(measureOffset({ fetch: garbage, samples: 4 })).resolves.toBeNull()

    const offline: FetchLike = () => Promise.reject(new TypeError('Failed to fetch'))
    await expect(measureOffset({ fetch: offline })).resolves.toBeNull()
  })

  it('ignores a sample during which the device clock went backwards', async () => {
    let device = BASE
    const fetch: FetchLike = () => {
      device -= 5000
      return Promise.resolve(json({ now: device }))
    }
    await expect(measureOffset({ fetch, clock: () => device, samples: 1 })).resolves.toBeNull()
  })

  it('gives up on a request that takes too long', async () => {
    vi.useFakeTimers({ now: BASE })
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    const measuring = measureOffset({ fetch, samples: 2 })
    await vi.advanceTimersByTimeAsync(CLOCK_SAMPLE_TIMEOUT_MS - 1)
    let settled = false
    void measuring.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(CLOCK_SAMPLE_TIMEOUT_MS + 1)
    await expect(measuring).resolves.toBeNull()
  })

  it('reads the device clock, not the app clock', async () => {
    vi.useFakeTimers({ now: BASE })
    setClockOffset(9000)
    const fetch: FetchLike = () => Promise.resolve(json({ now: Date.now() + 3000 }))
    await expect(measureOffset({ fetch, samples: 1 })).resolves.toBe(3000)
  })
})

describe('bestSample', () => {
  it('keeps the first of equally quick samples and skips missing ones', () => {
    const quick = { offset: 1, roundTrip: 10 }
    expect(bestSample([null, quick, { offset: 2, roundTrip: 10 }, null])).toBe(quick)
    expect(bestSample([null, null])).toBeNull()
    expect(bestSample([])).toBeNull()
  })
})

describe('applicableOffset', () => {
  it('applies offsets of 250 ms or more either way, and nothing smaller', () => {
    expect(CLOCK_OFFSET_THRESHOLD_MS).toBe(250)
    expect(applicableOffset(0)).toBe(0)
    expect(applicableOffset(249)).toBe(0)
    expect(applicableOffset(-249.9)).toBe(0)
    expect(applicableOffset(250)).toBe(250)
    expect(applicableOffset(-250)).toBe(-250)
    expect(applicableOffset(86_400_000)).toBe(86_400_000)
    expect(applicableOffset(Number.NaN)).toBe(0)
    expect(applicableOffset(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('createClockSync', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: BASE })
  })

  /** A clock sync over scripted measurements and a recorded offset. */
  function setup(results: (number | null | Error)[]) {
    let offset = 0
    const applied: number[] = []
    let calls = 0
    const sync = createClockSync({
      measure: () => {
        const result = results[calls++] ?? null
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
      },
      apply: (next) => {
        offset = next
        applied.push(next)
      },
      current: () => offset,
    })
    return { sync, applied, calls: () => calls }
  }

  it('measures on start and applies the offset', async () => {
    const { sync, applied } = setup([1200])
    expect(sync.running).toBe(false)
    sync.start()
    expect(sync.running).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(applied).toEqual([1200])
  })

  it('measures again every 30 minutes while started', async () => {
    const { sync, applied, calls } = setup([1200, 1200, 5000, 100])
    sync.start()
    await vi.advanceTimersByTimeAsync(CLOCK_REMEASURE_INTERVAL_MS - 1)
    expect(calls()).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls()).toBe(2)
    // An unchanged offset is not applied again.
    expect(applied).toEqual([1200])
    await vi.advanceTimersByTimeAsync(CLOCK_REMEASURE_INTERVAL_MS)
    expect(applied).toEqual([1200, 5000])
    // Under the threshold: back to the device clock.
    await vi.advanceTimersByTimeAsync(CLOCK_REMEASURE_INTERVAL_MS)
    expect(applied).toEqual([1200, 5000, 0])
    sync.stop()
  })

  it('keeps the offset when a measurement fails', async () => {
    const { sync, applied } = setup([3000, null, new Error('boom')])
    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    await sync.measure()
    await sync.measure()
    expect(applied).toEqual([3000])
    sync.stop()
  })

  it('shares one measurement between overlapping calls', async () => {
    const { sync, calls } = setup([700, 800])
    const first = sync.measure()
    const second = sync.measure()
    expect(second).toBe(first)
    await first
    expect(calls()).toBe(1)
    await sync.measure()
    expect(calls()).toBe(2)
  })

  it('resets the offset to 0 on stop and stops measuring', async () => {
    const { sync, applied, calls } = setup([2500])
    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    sync.stop()
    expect(sync.running).toBe(false)
    expect(applied).toEqual([2500, 0])
    await vi.advanceTimersByTimeAsync(CLOCK_REMEASURE_INTERVAL_MS * 3)
    expect(calls()).toBe(1)
    sync.stop()
    expect(applied).toEqual([2500, 0])
  })

  it('discards a measurement that finishes after stop', async () => {
    let finish: (value: number) => void = () => undefined
    const applied: number[] = []
    const sync = createClockSync({
      measure: () =>
        new Promise((resolve) => {
          finish = resolve
        }),
      apply: (next) => applied.push(next),
      current: () => applied.at(-1) ?? 0,
    })
    sync.start()
    sync.stop()
    finish(4000)
    await vi.advanceTimersByTimeAsync(0)
    expect(applied).toEqual([])
  })

  it('is idempotent on start', async () => {
    const { sync, calls } = setup([500, 500])
    sync.start()
    sync.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls()).toBe(1)
    sync.stop()
  })

  it('drives the app clock by default', async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(json({ now: Date.now() + 90_000 })))
    vi.stubGlobal('fetch', fetch)
    try {
      await clockSync.measure()
      expect(clockOffset()).toBe(90_000)
      expect(appClock()).toBe(Date.now() + 90_000)
      expect(fetch).toHaveBeenCalledWith(
        '/api/time',
        expect.objectContaining({ cache: 'no-store' }),
      )
      clockSync.stop()
      expect(clockOffset()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
