import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createWebWakeScheduler,
  type VisibilityLike,
  type WakeWorkerLike,
  type WebWakeSchedulerOptions,
} from './wake'
import { WAKE_FIRE, connectWakeWorker, type WakeRequest } from './wake-timer'

const BASE = Date.UTC(2030, 0, 1, 9, 30)

beforeEach(() => {
  vi.useFakeTimers({ now: BASE })
})

afterEach(() => {
  vi.useRealTimers()
})

type Listener = (event: { readonly data?: unknown }) => void

/** A worker the test drives: it records posts, and `emit` plays the worker's side. */
class FakeWorker implements WakeWorkerLike {
  readonly posted: WakeRequest[] = []
  readonly listeners = new Map<string, Listener[]>()
  terminated = false
  postMessage(message: WakeRequest): void {
    this.posted.push(message)
  }
  addEventListener(type: 'message' | 'error', listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }
  terminate(): void {
    this.terminated = true
  }
  emit(type: 'message' | 'error', data?: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data })
  }
  fire(): void {
    this.emit('message', WAKE_FIRE)
  }
}

/** A worker that runs the real worker logic in-process, so both ends of the protocol are tested. */
class LoopbackWorker extends FakeWorker {
  private readonly deliver: (data: unknown) => void
  constructor() {
    super()
    let receive: (event: { readonly data: unknown }) => void = () => undefined
    connectWakeWorker({
      addEventListener: (_type, listener) => {
        receive = listener
      },
      postMessage: (message) => {
        this.emit('message', message)
      },
    })
    this.deliver = (data) => {
      receive({ data: structuredClone(data) })
    }
  }
  override postMessage(message: WakeRequest): void {
    super.postMessage(message)
    this.deliver(message)
  }
}

class FakeVisibility extends EventTarget implements VisibilityLike {
  visibilityState: DocumentVisibilityState = 'visible'
  hide(): void {
    this.visibilityState = 'hidden'
    this.dispatchEvent(new Event('visibilitychange'))
  }
  show(): void {
    this.visibilityState = 'visible'
    this.dispatchEvent(new Event('visibilitychange'))
  }
}

function setup(options: WebWakeSchedulerOptions = {}) {
  const workers: FakeWorker[] = []
  const visibility = new FakeVisibility()
  const scheduler = createWebWakeScheduler({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    visibility,
    ...options,
  })
  return {
    scheduler,
    workers,
    visibility,
    worker: (): FakeWorker => {
      expect(workers).toHaveLength(1)
      const [worker] = workers
      if (!worker) throw new Error('no worker')
      return worker
    },
  }
}

describe('createWebWakeScheduler with a worker', () => {
  it('spawns no worker until the first deadline', () => {
    const { scheduler, workers } = setup()
    scheduler.schedule(null, vi.fn())
    expect(workers).toHaveLength(0)
    scheduler.schedule(BASE + 1000, vi.fn())
    expect(workers).toHaveLength(1)
  })

  it('posts the deadline to the worker', () => {
    const { scheduler, worker } = setup()
    scheduler.schedule(BASE + 1000, vi.fn())
    expect(worker().posted).toEqual([{ at: BASE + 1000 }])
  })

  it('does not repost an unchanged deadline but uses the newest callback', () => {
    const { scheduler, worker } = setup()
    const first = vi.fn()
    const second = vi.fn()
    scheduler.schedule(BASE + 1000, first)
    scheduler.schedule(BASE + 1000, second)
    expect(worker().posted).toHaveLength(1)
    vi.setSystemTime(BASE + 1000)
    worker().fire()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('posts a changed deadline', () => {
    const { scheduler, worker } = setup()
    scheduler.schedule(BASE + 1000, vi.fn())
    scheduler.schedule(BASE + 500, vi.fn())
    expect(worker().posted).toEqual([{ at: BASE + 1000 }, { at: BASE + 500 }])
  })

  it('cancels with null once, and treats a non-finite deadline as null', () => {
    const { scheduler, worker } = setup()
    scheduler.schedule(BASE + 1000, vi.fn())
    scheduler.schedule(null, vi.fn())
    scheduler.schedule(null, vi.fn())
    scheduler.schedule(BASE + 2000, vi.fn())
    scheduler.schedule(Number.NaN, vi.fn())
    expect(worker().posted).toEqual([
      { at: BASE + 1000 },
      { at: null },
      { at: BASE + 2000 },
      { at: null },
    ])
  })

  it('calls onFire once when the worker reports a passed deadline', () => {
    const { scheduler, worker } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    vi.setSystemTime(BASE + 1000)
    worker().fire()
    worker().fire()
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('re-arms instead of firing when the worker reports before the clock reaches the deadline', () => {
    const { scheduler, worker } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    vi.setSystemTime(BASE + 999)
    worker().fire()
    expect(onFire).not.toHaveBeenCalled()
    expect(worker().posted).toEqual([{ at: BASE + 1000 }, { at: BASE + 1000 }])
  })

  it('ignores a fire that arrives after the deadline was cancelled', () => {
    const { scheduler, worker } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    scheduler.schedule(null, onFire)
    vi.setSystemTime(BASE + 1000)
    worker().fire()
    expect(onFire).not.toHaveBeenCalled()
  })

  it('ignores unknown messages from the worker', () => {
    const { scheduler, worker } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE, onFire)
    worker().emit('message', 'hello')
    worker().emit('message', { at: 1 })
    expect(onFire).not.toHaveBeenCalled()
  })

  it('converts deadlines into the worker clock when the app clock is offset', () => {
    // The app clock runs 5 s ahead of the device clock, e.g. after server-time correction.
    const clock = (): number => Date.now() + 5000
    const { scheduler, worker } = setup({ clock })
    const onFire = vi.fn()
    scheduler.schedule(BASE + 5000 + 1000, onFire)
    expect(worker().posted).toEqual([{ at: BASE + 1000 }])
    vi.setSystemTime(BASE + 1000)
    worker().fire()
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('falls back to a main-thread timeout when the worker fails, and still fires on time', () => {
    const { scheduler, worker } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    worker().emit('error')
    expect(worker().terminated).toBe(true)
    vi.advanceTimersByTime(999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    // The dead worker gets no more requests, and a late message from it is ignored.
    scheduler.schedule(BASE + 5000, onFire)
    worker().fire()
    expect(worker().posted).toEqual([{ at: BASE + 1000 }])
    vi.advanceTimersByTime(4000)
    expect(onFire).toHaveBeenCalledTimes(2)
  })

  it('falls back to a main-thread timeout when the worker cannot be created', () => {
    const onFire = vi.fn()
    const { scheduler } = setup({
      createWorker: () => {
        throw new Error('blocked by CSP')
      },
    })
    scheduler.schedule(BASE + 1000, onFire)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('terminates the worker and stops listening on dispose', () => {
    const { scheduler, worker, visibility } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    scheduler.dispose()
    expect(worker().terminated).toBe(true)
    vi.setSystemTime(BASE + 2000)
    worker().fire()
    visibility.show()
    expect(onFire).not.toHaveBeenCalled()
  })

  it('works end to end with the real worker logic', () => {
    const workers: LoopbackWorker[] = []
    const scheduler = createWebWakeScheduler({
      createWorker: () => {
        const worker = new LoopbackWorker()
        workers.push(worker)
        return worker
      },
      visibility: null,
    })
    const onFire = vi.fn()
    scheduler.schedule(BASE + 3000, onFire)
    scheduler.schedule(BASE + 2000, onFire)
    vi.advanceTimersByTime(1999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    scheduler.schedule(BASE + 4000, onFire)
    scheduler.schedule(null, onFire)
    vi.advanceTimersByTime(10_000)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(workers).toHaveLength(1)
  })
})

describe('createWebWakeScheduler without workers', () => {
  it('fires on time from a main-thread timeout', () => {
    const { scheduler, workers } = setup({ createWorker: null })
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1500, onFire)
    vi.advanceTimersByTime(1499)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(workers).toHaveLength(0)
  })

  it('fires a past deadline asynchronously, never inside schedule', () => {
    const { scheduler } = setup({ createWorker: null })
    const onFire = vi.fn()
    scheduler.schedule(BASE - 10, onFire)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(0)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('follows rescheduling and cancelling', () => {
    const { scheduler } = setup({ createWorker: null })
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    scheduler.schedule(BASE + 2000, onFire)
    vi.advanceTimersByTime(1500)
    expect(onFire).not.toHaveBeenCalled()
    scheduler.schedule(null, onFire)
    vi.advanceTimersByTime(5000)
    expect(onFire).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('lets onFire schedule the next deadline', () => {
    const { scheduler } = setup({ createWorker: null })
    const fired: number[] = []
    const onFire = (): void => {
      fired.push(Date.now())
      if (fired.length < 3) scheduler.schedule(Date.now() + 1000, onFire)
    }
    scheduler.schedule(BASE + 1000, onFire)
    vi.advanceTimersByTime(10_000)
    expect(fired).toEqual([BASE + 1000, BASE + 2000, BASE + 3000])
  })
})

describe('createWebWakeScheduler visibility', () => {
  it('fires a deadline that passed while hidden as soon as the page is visible', () => {
    const { scheduler, worker, visibility } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    visibility.hide()
    // The worker was frozen with the tab and never reported.
    vi.setSystemTime(BASE + 60_000)
    visibility.show()
    expect(onFire).toHaveBeenCalledTimes(1)
    // The worker's now-stale deadline is cancelled, and its late report is ignored.
    expect(worker().posted.at(-1)).toEqual({ at: null })
    worker().fire()
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('calls onFire to catch up on becoming visible before the deadline, and still fires at it', () => {
    const { scheduler, worker, visibility } = setup()
    const onFire = vi.fn()
    scheduler.schedule(BASE + 10_000, onFire)
    visibility.hide()
    vi.setSystemTime(BASE + 5000)
    visibility.show()
    expect(onFire).toHaveBeenCalledTimes(1)
    // The deadline is re-armed (re-synced), not dropped.
    expect(worker().posted).toEqual([{ at: BASE + 10_000 }, { at: BASE + 10_000 }])
    vi.setSystemTime(BASE + 10_000)
    worker().fire()
    expect(onFire).toHaveBeenCalledTimes(2)
  })

  it('does nothing when hidden or when no deadline is pending', () => {
    const { scheduler, visibility } = setup()
    const onFire = vi.fn()
    scheduler.schedule(null, onFire)
    visibility.show()
    scheduler.schedule(BASE + 1000, onFire)
    visibility.hide()
    expect(onFire).not.toHaveBeenCalled()
  })

  it('listens once however often it schedules', () => {
    const visibility = new FakeVisibility()
    const add = vi.spyOn(visibility, 'addEventListener')
    const scheduler = createWebWakeScheduler({ createWorker: null, visibility })
    expect(add).not.toHaveBeenCalled()
    for (let i = 0; i < 5; i++) scheduler.schedule(BASE + 1000 * i, vi.fn())
    expect(add).toHaveBeenCalledTimes(1)
  })

  it('works without a visibility source', () => {
    const scheduler = createWebWakeScheduler({ createWorker: null, visibility: null })
    const onFire = vi.fn()
    scheduler.schedule(BASE + 1000, onFire)
    vi.advanceTimersByTime(1000)
    expect(onFire).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })
})
