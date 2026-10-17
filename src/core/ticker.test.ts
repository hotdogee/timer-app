import fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { systemClock, type Clock } from './clock'
import { createTicker, type FrameScheduler, type Ticker } from './ticker'
import type { EpochMs } from './types'

const BASE: EpochMs = Date.UTC(2030, 0, 1, 9, 30)
const FRAME_MS = 16
const SCHEDULER_FAILURE = new Error('scheduler unavailable')

interface QueuedFrame {
  readonly handle: unknown
  readonly callback: () => void
  cancelled: boolean
}

/** A frame scheduler played by hand: each `flush()` is one display frame. */
interface ManualScheduler extends FrameScheduler {
  /**
   * Runs the callbacks queued before this call, in request order, like one requestAnimationFrame
   * batch. Callbacks requested during the flush wait for the next one. A callback cancelled
   * during the flush is skipped, unless the scheduler ignores cancellation.
   */
  flush(): void
  /** Number of queued callbacks that have not fired and were not cancelled. */
  live(): number
  /** Handles returned by `request`, in order. */
  readonly requests: readonly unknown[]
  /** Handles passed to `cancel`, in order. */
  readonly cancels: readonly unknown[]
}

interface ManualSchedulerOptions {
  /** When false, cancelled callbacks still fire, like a frame the scheduler had already dequeued. */
  readonly honorCancel?: boolean
  /** The handle returned for the n-th successful request (1-based). Defaults to n. */
  readonly handleFor?: (request: number) => unknown
  /** Whether the n-th request attempt (1-based) throws SCHEDULER_FAILURE. Defaults to never. */
  readonly failOnRequest?: (attempt: number) => boolean
}

function manualScheduler(options: ManualSchedulerOptions = {}): ManualScheduler {
  const { honorCancel = true, handleFor = (n) => n, failOnRequest = () => false } = options
  let queue: QueuedFrame[] = []
  // The batch `flush` is running, so `cancel` can reach its frames that have not run yet.
  let batch: readonly QueuedFrame[] = []
  const requests: unknown[] = []
  const cancels: unknown[] = []
  let attempts = 0
  return {
    requests,
    cancels,
    request(callback) {
      attempts += 1
      if (failOnRequest(attempts)) throw SCHEDULER_FAILURE
      const handle = handleFor(requests.length + 1)
      requests.push(handle)
      queue.push({ handle, callback, cancelled: false })
      return handle
    },
    cancel(handle) {
      cancels.push(handle)
      for (const frame of [...batch, ...queue]) {
        if (frame.handle === handle) frame.cancelled = true
      }
    },
    flush() {
      batch = queue
      queue = []
      try {
        for (const frame of batch) {
          if (honorCancel && frame.cancelled) continue
          frame.callback()
        }
      } finally {
        batch = []
      }
    },
    live() {
      return queue.filter((frame) => !frame.cancelled).length
    },
  }
}

/** A clock that returns each scripted value in turn, then repeats the last one. */
function scriptedClock(...values: EpochMs[]): Clock {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0
    index += 1
    return value
  }
}

/** Captures what `fn` throws, or returns `undefined` if it does not throw. */
function thrownBy(fn: () => void): unknown {
  try {
    fn()
  } catch (error) {
    return error
  }
  return undefined
}

interface Harness {
  readonly scheduler: ManualScheduler
  readonly ticker: Ticker
  /** Every `now` passed to onTick, in order. */
  readonly ticks: readonly EpochMs[]
  /** Advances the clock by `ms`, then plays one frame. */
  readonly frame: (ms?: number) => void
}

/**
 * A ticker on a manual scheduler and a clock that only moves when `frame()` advances it.
 * `inTick` runs inside onTick after the tick is recorded (for re-entrant calls and throws).
 */
function setup(
  options: ManualSchedulerOptions & { readonly inTick?: (ticker: Ticker) => void } = {},
): Harness {
  const { inTick = () => undefined, ...schedulerOptions } = options
  const scheduler = manualScheduler(schedulerOptions)
  const ticks: EpochMs[] = []
  let now = BASE
  const ticker = createTicker({
    scheduler,
    clock: () => now,
    onTick: (tickNow) => {
      ticks.push(tickNow)
      inTick(ticker)
    },
  })
  return {
    scheduler,
    ticker,
    ticks,
    frame(ms = FRAME_MS) {
      now += ms
      scheduler.flush()
    },
  }
}

describe('createTicker', () => {
  describe('activation', () => {
    it('starts inactive without requesting a frame', () => {
      const { ticker, scheduler } = setup()
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.requests).toEqual([])
    })

    it('requests exactly one frame when activated', () => {
      const { ticker, scheduler } = setup()
      ticker.setActive(true)
      expect(ticker.isActive()).toBe(true)
      expect(scheduler.requests).toHaveLength(1)
      expect(scheduler.live()).toBe(1)
    })

    it('does not call onTick until the first frame fires', () => {
      const { ticker, ticks } = setup()
      ticker.setActive(true)
      expect(ticks).toEqual([])
    })

    it('requests only one frame when activated twice', () => {
      const { ticker, scheduler } = setup()
      ticker.setActive(true)
      ticker.setActive(true)
      expect(scheduler.requests).toHaveLength(1)
      expect(scheduler.live()).toBe(1)
    })

    it('ticks once per frame however many times it was activated', () => {
      const { ticker, ticks, frame } = setup()
      ticker.setActive(true)
      ticker.setActive(true)
      ticker.setActive(true)
      frame()
      expect(ticks).toHaveLength(1)
    })

    it('ignores a callback fired inside request, so a synchronous scheduler stalls (unsupported)', () => {
      let requests = 0
      const ticks: EpochMs[] = []
      const ticker = createTicker({
        scheduler: {
          request(callback) {
            requests += 1
            callback()
            return requests
          },
          cancel: () => undefined,
        },
        clock: () => BASE,
        onTick: (now) => {
          ticks.push(now)
        },
      })
      expect(thrownBy(() => ticker.setActive(true))).toBeUndefined()
      expect(ticks).toEqual([])
      expect(requests).toBe(1)
      expect(ticker.isActive()).toBe(true)
    })

    it('does nothing when deactivated while already inactive', () => {
      const { ticker, scheduler } = setup()
      ticker.setActive(false)
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.requests).toEqual([])
      expect(scheduler.cancels).toEqual([])
    })
  })

  describe('frames', () => {
    it('calls onTick with the clock reading taken when each frame fires', () => {
      const { ticker, ticks, frame } = setup()
      ticker.setActive(true)
      frame(16)
      frame(17)
      frame(250)
      expect(ticks).toEqual([BASE + 16, BASE + 33, BASE + 283])
    })

    it('requests the next frame after each tick, keeping exactly one frame pending', () => {
      const { ticker, scheduler, frame } = setup()
      ticker.setActive(true)
      frame()
      frame()
      frame()
      expect(scheduler.requests).toHaveLength(4)
      expect(scheduler.live()).toBe(1)
    })

    it('reads the clock once per frame and never on activation', () => {
      const scheduler = manualScheduler()
      let reads = 0
      const ticker = createTicker({
        scheduler,
        clock: () => {
          reads += 1
          return BASE
        },
        onTick: () => undefined,
      })
      ticker.setActive(true)
      expect(reads).toBe(0)
      scheduler.flush()
      scheduler.flush()
      expect(reads).toBe(2)
    })

    it('passes clock readings through unchanged, even when the clock goes backwards', () => {
      const scheduler = manualScheduler()
      const ticks: EpochMs[] = []
      const ticker = createTicker({
        scheduler,
        clock: scriptedClock(BASE, BASE - 5000, BASE + 1),
        onTick: (now) => {
          ticks.push(now)
        },
      })
      ticker.setActive(true)
      scheduler.flush()
      scheduler.flush()
      scheduler.flush()
      expect(ticks).toEqual([BASE, BASE - 5000, BASE + 1])
    })
  })

  describe('deactivation', () => {
    it('cancels the pending frame with the handle the scheduler returned for it', () => {
      const { ticker, scheduler, frame } = setup()
      ticker.setActive(true)
      frame()
      ticker.setActive(false)
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.cancels).toEqual([scheduler.requests.at(-1)])
      expect(scheduler.live()).toBe(0)
    })

    it('stops calling onTick and requesting frames after deactivation', () => {
      const { ticker, scheduler, ticks, frame } = setup()
      ticker.setActive(true)
      frame()
      ticker.setActive(false)
      frame()
      frame()
      expect(ticks).toHaveLength(1)
      expect(scheduler.requests).toHaveLength(2)
    })

    it('does not tick when the scheduler fires a frame it was asked to cancel', () => {
      const { ticker, scheduler, ticks, frame } = setup({ honorCancel: false })
      ticker.setActive(true)
      ticker.setActive(false)
      frame()
      expect(ticks).toEqual([])
      expect(scheduler.requests).toHaveLength(1)
    })

    it.each([
      { label: 'skips cancelled frames', honorCancel: true },
      { label: 'still fires cancelled frames', honorCancel: false },
    ])(
      'does not tick when deactivated by another callback earlier in the same frame, if the scheduler $label',
      ({ honorCancel }) => {
        const scheduler = manualScheduler({ honorCancel })
        const ticks: EpochMs[] = []
        const ticker = createTicker({
          scheduler,
          clock: () => BASE,
          onTick: (now) => {
            ticks.push(now)
          },
        })
        // Another rAF consumer queued before the ticker's frame stops the ticker during the batch.
        // A scheduler that ignores the cancel still fires the frame; the ticker must drop it.
        scheduler.request(() => {
          ticker.setActive(false)
        })
        ticker.setActive(true)
        scheduler.flush()
        expect(ticks).toEqual([])
        expect(scheduler.cancels).toEqual([scheduler.requests[1]])
        expect(scheduler.live()).toBe(0)
      },
    )

    it('ignores a stale frame after being deactivated and reactivated', () => {
      const { ticker, scheduler, ticks, frame } = setup({ honorCancel: false })
      ticker.setActive(true)
      ticker.setActive(false)
      ticker.setActive(true)
      frame() // fires both the stale and the current frame
      expect(ticks).toEqual([BASE + FRAME_MS])
      expect(scheduler.live()).toBe(1)
    })

    it('resumes ticking from a fresh frame when reactivated', () => {
      const { ticker, scheduler, ticks, frame } = setup()
      ticker.setActive(true)
      frame()
      ticker.setActive(false)
      frame()
      ticker.setActive(true)
      expect(scheduler.live()).toBe(1)
      frame()
      expect(ticks).toEqual([BASE + FRAME_MS, BASE + 3 * FRAME_MS])
    })

    it.each([
      { label: '0', handle: 0 },
      { label: 'null', handle: null },
      { label: 'undefined', handle: undefined },
      { label: 'an empty string', handle: '' },
      { label: 'an object', handle: { id: 7 } },
    ])('cancels with the exact handle even when it is $label', ({ handle }) => {
      const { ticker, scheduler } = setup({ handleFor: () => handle })
      ticker.setActive(true)
      ticker.setActive(false)
      expect(scheduler.cancels).toHaveLength(1)
      expect(scheduler.cancels[0]).toBe(handle)
    })

    it('requires cancel to accept the handle type that request returns (checked by tsc)', () => {
      const mismatched = { request: () => 1, cancel: (handle: string) => handle.length }
      const options = { scheduler: mismatched, clock: () => BASE, onTick: () => undefined }
      // @ts-expect-error: cancel takes strings but request returns numbers
      const ticker = createTicker(options)
      expect(ticker.isActive()).toBe(false)
    })
  })

  describe('calls from inside onTick', () => {
    it('stops the loop when onTick deactivates the ticker', () => {
      const { ticker, scheduler, ticks, frame } = setup({ inTick: (t) => t.setActive(false) })
      ticker.setActive(true)
      frame()
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.live()).toBe(0)
      frame()
      expect(ticks).toHaveLength(1)
      expect(scheduler.requests).toHaveLength(1)
    })

    it('keeps exactly one frame pending when onTick deactivates and reactivates the ticker', () => {
      const { ticker, scheduler, ticks, frame } = setup({
        inTick: (t) => {
          t.setActive(false)
          t.setActive(true)
        },
      })
      ticker.setActive(true)
      frame()
      expect(ticker.isActive()).toBe(true)
      expect(scheduler.requests).toHaveLength(2)
      expect(scheduler.live()).toBe(1)
      frame()
      expect(ticks).toHaveLength(2)
    })

    it('treats activation from inside onTick as a no-op and requests one next frame', () => {
      const { ticker, scheduler, frame } = setup({ inTick: (t) => t.setActive(true) })
      ticker.setActive(true)
      frame()
      frame()
      expect(scheduler.requests).toHaveLength(3)
      expect(scheduler.live()).toBe(1)
    })

    it('reports itself active while onTick runs', () => {
      const seen: boolean[] = []
      const { ticker, frame } = setup({ inTick: (t) => seen.push(t.isActive()) })
      ticker.setActive(true)
      frame()
      expect(seen).toEqual([true])
    })
  })

  describe('errors', () => {
    const boom = new Error('onTick failed')
    const throwBoom = (): never => {
      throw boom
    }

    it('rethrows the exact error thrown by onTick', () => {
      const { ticker, frame } = setup({ inTick: throwBoom })
      ticker.setActive(true)
      expect(thrownBy(() => frame())).toBe(boom)
    })

    it('stops the loop after onTick throws', () => {
      const { ticker, scheduler, ticks, frame } = setup({ inTick: throwBoom })
      ticker.setActive(true)
      expect(thrownBy(() => frame())).toBe(boom)
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.live()).toBe(0)
      frame()
      expect(ticks).toHaveLength(1)
      expect(scheduler.requests).toHaveLength(1)
    })

    it('can be activated again after onTick throws', () => {
      let shouldThrow = true
      const { ticker, ticks, frame } = setup({
        inTick: () => {
          if (shouldThrow) throwBoom()
        },
      })
      ticker.setActive(true)
      expect(thrownBy(() => frame())).toBe(boom)
      shouldThrow = false
      ticker.setActive(true)
      expect(ticker.isActive()).toBe(true)
      frame()
      frame()
      expect(ticks).toEqual([BASE + FRAME_MS, BASE + 2 * FRAME_MS, BASE + 3 * FRAME_MS])
    })

    it('cancels a frame that onTick requested before it threw', () => {
      const { ticker, scheduler, ticks, frame } = setup({
        honorCancel: false,
        inTick: (t) => {
          t.setActive(false)
          t.setActive(true)
          throwBoom()
        },
      })
      ticker.setActive(true)
      expect(thrownBy(() => frame())).toBe(boom)
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.cancels).toEqual([scheduler.requests[1]])
      frame() // the cancelled frame fires anyway on this scheduler
      expect(ticks).toHaveLength(1)
    })

    it('stops the loop and rethrows when the clock throws', () => {
      const scheduler = manualScheduler()
      const clockFailure = new Error('clock failed')
      let ticks = 0
      const ticker = createTicker({
        scheduler,
        clock: () => {
          throw clockFailure
        },
        onTick: () => {
          ticks += 1
        },
      })
      ticker.setActive(true)
      expect(thrownBy(() => scheduler.flush())).toBe(clockFailure)
      expect(ticks).toBe(0)
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.live()).toBe(0)
    })

    it('stays inactive when the scheduler fails to request the first frame', () => {
      let failing = true
      const { ticker, scheduler, ticks, frame } = setup({ failOnRequest: () => failing })
      expect(thrownBy(() => ticker.setActive(true))).toBe(SCHEDULER_FAILURE)
      expect(ticker.isActive()).toBe(false)
      failing = false
      ticker.setActive(true)
      expect(scheduler.requests).toHaveLength(1)
      frame()
      expect(ticks).toHaveLength(1)
    })

    it('stops the loop when requesting the next frame fails', () => {
      const { ticker, scheduler, ticks, frame } = setup({
        failOnRequest: (attempt) => attempt === 2,
      })
      ticker.setActive(true)
      expect(thrownBy(() => frame())).toBe(SCHEDULER_FAILURE)
      expect(ticks).toHaveLength(1)
      expect(ticker.isActive()).toBe(false)
      expect(scheduler.live()).toBe(0)
    })
  })

  describe('with setTimeout-based frames (fake timers)', () => {
    const timeoutScheduler: FrameScheduler<ReturnType<typeof setTimeout>> = {
      request: (callback) => setTimeout(callback, FRAME_MS),
      cancel(handle) {
        clearTimeout(handle)
      },
    }

    function startTicking(onTick: (now: EpochMs) => void = () => undefined): Ticker {
      const ticker = createTicker({ scheduler: timeoutScheduler, clock: systemClock, onTick })
      ticker.setActive(true)
      return ticker
    }

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(BASE)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('ticks once per frame interval with the system time', () => {
      const ticks: EpochMs[] = []
      startTicking((now) => ticks.push(now))
      vi.advanceTimersByTime(3 * FRAME_MS + 5)
      expect(ticks).toEqual([BASE + FRAME_MS, BASE + 2 * FRAME_MS, BASE + 3 * FRAME_MS])
    })

    it('keeps a single timer pending over a long run', () => {
      let ticks = 0
      startTicking(() => {
        ticks += 1
      })
      vi.advanceTimersByTime(10_000)
      expect(ticks).toBe(10_000 / FRAME_MS)
      expect(vi.getTimerCount()).toBe(1)
    })

    it('leaves no timer behind and stops ticking after deactivation', () => {
      let ticks = 0
      const ticker = startTicking(() => {
        ticks += 1
      })
      vi.advanceTimersByTime(2 * FRAME_MS + 3)
      ticker.setActive(false)
      expect(vi.getTimerCount()).toBe(0)
      vi.advanceTimersByTime(1000)
      expect(ticks).toBe(2)
    })

    it('stops and leaves no timer behind when onTick throws in a timer callback', () => {
      const boom = new Error('onTick failed')
      const ticker = startTicking(() => {
        throw boom
      })
      expect(thrownBy(() => vi.advanceTimersByTime(5 * FRAME_MS))).toBe(boom)
      expect(ticker.isActive()).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('properties', () => {
    type Op =
      | { readonly kind: 'set'; readonly active: boolean }
      | {
          readonly kind: 'frame'
          /** setActive calls made from inside onTick, in order. */
          readonly inside: readonly boolean[]
          /** Whether onTick throws after making those calls. */
          readonly throws: boolean
        }

    const opArb: fc.Arbitrary<Op> = fc.oneof(
      fc.record({ kind: fc.constant('set' as const), active: fc.boolean() }),
      fc.record({
        kind: fc.constant('frame' as const),
        inside: fc.array(fc.boolean(), { maxLength: 3 }),
        throws: fc.boolean(),
      }),
    )

    it('matches an on/off model for any interleaving of setActive calls, frames and throws', () => {
      fc.assert(
        fc.property(fc.boolean(), fc.array(opArb, { maxLength: 40 }), (honorCancel, ops) => {
          const failure = new Error('onTick failed')
          let current: Op | undefined
          const { ticker, scheduler, ticks, frame } = setup({
            honorCancel,
            inTick: (t) => {
              if (current?.kind !== 'frame') return
              for (const active of current.inside) t.setActive(active)
              if (current.throws) throw failure
            },
          })
          let modelActive = false
          let framesPlayed = 0
          for (const op of ops) {
            current = op
            if (op.kind === 'set') {
              ticker.setActive(op.active)
              modelActive = op.active
            } else {
              const ticksBefore = ticks.length
              const ticked = modelActive
              const thrown = thrownBy(() => frame())
              framesPlayed += 1
              // One tick while active, carrying this frame's clock reading; none while inactive.
              const expectedTicks = ticked ? [BASE + framesPlayed * FRAME_MS] : []
              expect(ticks.slice(ticksBefore)).toEqual(expectedTicks)
              if (ticked) {
                for (const active of op.inside) modelActive = active
                if (op.throws) modelActive = false
              }
              expect(thrown).toBe(ticked && op.throws ? failure : undefined)
            }
            expect(ticker.isActive()).toBe(modelActive)
            expect(scheduler.live()).toBe(modelActive ? 1 : 0)
          }
        }),
      )
    })
  })
})

describe('manualScheduler (test helper)', () => {
  it.each([
    { honorCancel: true, expected: ['first'] },
    { honorCancel: false, expected: ['first', 'second'] },
  ])(
    'with honorCancel $honorCancel, runs $expected when the first callback cancels the second in one flush',
    ({ honorCancel, expected }) => {
      const scheduler = manualScheduler({ honorCancel })
      const ran: string[] = []
      scheduler.request(() => {
        ran.push('first')
        scheduler.cancel(scheduler.requests[1])
      })
      scheduler.request(() => {
        ran.push('second')
      })
      scheduler.flush()
      expect(ran).toEqual(expected)
      expect(scheduler.live()).toBe(0)
    },
  )
})
