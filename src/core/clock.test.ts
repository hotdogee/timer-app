import { afterEach, describe, expect, it, vi } from 'vitest'

import { offsetClock, systemClock, type Clock } from './clock'

/** A clock that returns each scripted value in turn, then repeats the last one. */
function scriptedClock(...values: number[]): Clock {
  let index = 0
  return () => {
    const value = values[Math.min(index, values.length - 1)] ?? 0
    index += 1
    return value
  }
}

describe('systemClock', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads Date.now()', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2030, 0, 1, 12, 0, 0))
    expect(systemClock()).toBe(Date.UTC(2030, 0, 1, 12, 0, 0))
  })

  it('follows the system time as it advances', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 17))
    const before = systemClock()
    vi.advanceTimersByTime(1500)
    expect(systemClock() - before).toBe(1500)
  })
})

describe('offsetClock', () => {
  const base = Date.UTC(2026, 9, 17, 14, 47)

  it('adds a positive offset', () => {
    expect(offsetClock(() => base, 2500)()).toBe(base + 2500)
  })

  it('adds a negative offset', () => {
    expect(offsetClock(() => base, -750)()).toBe(base - 750)
  })

  it('returns the base time unchanged for a zero offset', () => {
    expect(offsetClock(() => base, 0)()).toBe(base)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'treats a non-finite offset (%s) as 0',
    (offset) => {
      expect(offsetClock(() => base, offset)()).toBe(base)
    },
  )

  it.each([
    [2500.4, 2500],
    [2500.5, 2501],
    [-750.6, -751],
  ])('rounds a fractional offset (%s) to whole milliseconds', (offset, rounded) => {
    expect(offsetClock(() => base, offset)()).toBe(base + rounded)
  })

  it('reads the base clock on every call instead of caching it', () => {
    const clock = offsetClock(scriptedClock(1000, 2000, 3000), 10)
    expect([clock(), clock(), clock()]).toEqual([1010, 2010, 3010])
  })

  it('composes with another offset clock', () => {
    expect(
      offsetClock(
        offsetClock(() => base, 100),
        -40,
      )(),
    ).toBe(base + 60)
  })
})
