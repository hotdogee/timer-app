import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_SEED, isDefaultSeed, resolveSeed } from './seed'

const TIMEOUT = 50

/** An accent source that answers with `value` after `delay` ms (fake time). */
function delayed(value: string | null, delay: number) {
  return () =>
    new Promise<string | null>((resolve) => {
      setTimeout(() => {
        resolve(value)
      }, delay)
    })
}

describe('resolveSeed', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses an accent that answers in time, normalized', async () => {
    const seed = resolveSeed(delayed('#FF8800', 10), TIMEOUT)
    await vi.advanceTimersByTimeAsync(10)
    await expect(seed).resolves.toBe('#ff8800')
  })

  it('resolves without waiting for the timeout when the accent is immediate', async () => {
    await expect(resolveSeed(() => Promise.resolve('#123456'), TIMEOUT)).resolves.toBe('#123456')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back to the default for a null accent (the web)', async () => {
    await expect(resolveSeed(() => Promise.resolve(null), TIMEOUT)).resolves.toBe(DEFAULT_SEED)
  })

  it('falls back to the default for an invalid accent', async () => {
    await expect(resolveSeed(() => Promise.resolve('accent'), TIMEOUT)).resolves.toBe(DEFAULT_SEED)
  })

  it('falls back to the default when the accent rejects or throws', async () => {
    await expect(resolveSeed(() => Promise.reject(new Error('no')), TIMEOUT)).resolves.toBe(
      DEFAULT_SEED,
    )
    await expect(
      resolveSeed(() => {
        throw new Error('sync failure')
      }, TIMEOUT),
    ).resolves.toBe(DEFAULT_SEED)
  })

  it('gives up after the timeout and reports a late accent through onLate', async () => {
    const onLate = vi.fn()
    let settled: string | undefined
    void resolveSeed(delayed('#00aa00', 200), TIMEOUT, onLate).then((seed) => {
      settled = seed
    })

    await vi.advanceTimersByTimeAsync(TIMEOUT - 1)
    expect(settled).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(DEFAULT_SEED)
    expect(onLate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)
    expect(onLate).toHaveBeenCalledExactlyOnceWith('#00aa00')
  })

  it('does not call onLate when the late accent is null or invalid', async () => {
    const onLate = vi.fn()
    void resolveSeed(delayed(null, 100), TIMEOUT, onLate)
    void resolveSeed(delayed('nope', 100), TIMEOUT, onLate)
    await vi.advanceTimersByTimeAsync(200)
    expect(onLate).not.toHaveBeenCalled()
  })

  it('does not call onLate when the accent arrived in time', async () => {
    const onLate = vi.fn()
    void resolveSeed(delayed('#00aa00', 10), TIMEOUT, onLate)
    await vi.advanceTimersByTimeAsync(500)
    expect(onLate).not.toHaveBeenCalled()
  })
})

describe('isDefaultSeed', () => {
  it('recognizes the default seed in any accepted spelling', () => {
    expect(isDefaultSeed(DEFAULT_SEED)).toBe(true)
    expect(isDefaultSeed(' 0b57d0 ')).toBe(true)
    expect(isDefaultSeed('#0b57d1')).toBe(false)
    expect(isDefaultSeed('nope')).toBe(false)
  })
})
