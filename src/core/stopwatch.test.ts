import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  createStopwatch,
  currentLap,
  elapsed,
  lap,
  lapDurations,
  needsFrames,
  pause,
  reset,
  start,
  toggle,
} from './stopwatch'
import type { EpochMs, Ms, StopwatchPhase, StopwatchState } from './types'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** 2026-10-17 14:47:00 UTC: a fixed instant, independent of the machine's timezone. */
const T0 = Date.UTC(2026, 9, 17, 14, 47)

/** Freezes a state and its laps, so any mutation by the code under test throws (ESM is strict). */
function frozen(s: StopwatchState): StopwatchState {
  if (s.phase !== 'idle') Object.freeze(s.laps)
  return Object.freeze(s)
}

/** The recorded cumulative splits, read straight from the state. */
function splitsOf(s: StopwatchState): readonly Ms[] {
  return s.phase === 'idle' ? [] : s.laps
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

const idle = frozen({ phase: 'idle' })
/** Started at T0 after 5 s of earlier running, with one lap at 2 s. */
const running = frozen({
  phase: 'running',
  startedAt: T0,
  accumulated: 5 * SECOND,
  laps: [2 * SECOND],
})
/** Paused at 7 s with laps at 2 s and 6 s. */
const paused = frozen({ phase: 'paused', accumulated: 7 * SECOND, laps: [2 * SECOND, 6 * SECOND] })
const fixtures: Record<StopwatchPhase, StopwatchState> = { idle, running, paused }

type TransitionName = 'start' | 'pause' | 'toggle' | 'reset' | 'lap'
type Transition = (s: StopwatchState, now: EpochMs) => StopwatchState
const transitions: Record<TransitionName, Transition> = {
  start,
  pause,
  toggle,
  reset: (s) => reset(s),
  lap,
}

describe('transitions from every phase', () => {
  const now = T0 + 10 * SECOND

  it.each([
    ['start', 'idle', 'running'],
    ['start', 'paused', 'running'],
    ['pause', 'running', 'paused'],
    ['toggle', 'idle', 'running'],
    ['toggle', 'running', 'paused'],
    ['toggle', 'paused', 'running'],
    ['reset', 'running', 'idle'],
    ['reset', 'paused', 'idle'],
    ['lap', 'running', 'running'],
  ] as const)('%s from %s returns a new %s state', (name, from, to) => {
    const s = fixtures[from]
    const next = transitions[name](s, now)
    expect(next).not.toBe(s)
    expect(next.phase).toBe(to)
  })

  it.each([
    ['start', 'running'],
    ['pause', 'idle'],
    ['pause', 'paused'],
    ['reset', 'idle'],
    ['lap', 'idle'],
    ['lap', 'paused'],
  ] as const)('%s from %s is a no-op that returns the same state object', (name, from) => {
    const s = fixtures[from]
    expect(transitions[name](s, now)).toBe(s)
  })

  const timeDependent = [
    ['start', 'idle'],
    ['start', 'paused'],
    ['pause', 'running'],
    ['toggle', 'idle'],
    ['toggle', 'running'],
    ['toggle', 'paused'],
    ['lap', 'running'],
  ] as const
  const invalidNows = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]

  it.each(
    timeDependent.flatMap(([name, from]) => invalidNows.map((bad) => [name, from, bad] as const)),
  )('%s from %s with now = %s is a no-op that returns the same state object', (name, from, bad) => {
    const s = fixtures[from]
    expect(transitions[name](s, bad)).toBe(s)
  })
})

describe('createStopwatch', () => {
  it('starts idle, reading zero with no laps and no frames needed', () => {
    const s = createStopwatch()
    expect(s).toStrictEqual({ phase: 'idle' })
    expect(elapsed(s, T0)).toBe(0)
    expect(currentLap(s, T0)).toBe(0)
    expect(lapDurations(s)).toStrictEqual([])
    expect(needsFrames(s)).toBe(false)
  })
})

describe('start', () => {
  it('starts an idle stopwatch from zero with no laps', () => {
    expect(start(idle, T0)).toStrictEqual({
      phase: 'running',
      startedAt: T0,
      accumulated: 0,
      laps: [],
    })
  })

  it('resumes a paused stopwatch, keeping its accumulated time and laps', () => {
    expect(start(paused, T0 + MINUTE)).toStrictEqual({
      phase: 'running',
      startedAt: T0 + MINUTE,
      accumulated: 7 * SECOND,
      laps: [2 * SECOND, 6 * SECOND],
    })
  })

  it('does not count the time spent paused', () => {
    const resumed = start(paused, T0 + HOUR)
    expect(elapsed(resumed, T0 + HOUR + 3 * SECOND)).toBe(10 * SECOND)
  })
})

describe('pause', () => {
  it('freezes the elapsed time at now and keeps the laps', () => {
    expect(pause(running, T0 + 4 * SECOND)).toStrictEqual({
      phase: 'paused',
      accumulated: 9 * SECOND,
      laps: [2 * SECOND],
    })
  })

  it('stays frozen however much later it is read', () => {
    const s = pause(running, T0 + 4 * SECOND)
    expect(elapsed(s, T0 + 4 * SECOND)).toBe(9 * SECOND)
    expect(elapsed(s, T0 + 2 * HOUR)).toBe(9 * SECOND)
  })

  it('keeps the accumulated time when paused at the instant the stretch started', () => {
    expect(pause(running, T0)).toStrictEqual({
      phase: 'paused',
      accumulated: 5 * SECOND,
      laps: [2 * SECOND],
    })
  })

  it('adds nothing, instead of subtracting, when the clock went back before startedAt', () => {
    expect(pause(running, T0 - 30 * SECOND)).toStrictEqual({
      phase: 'paused',
      accumulated: 5 * SECOND,
      laps: [2 * SECOND],
    })
  })
})

describe('toggle', () => {
  it('cycles idle → running → paused → running, counting only the running time', () => {
    const s1 = toggle(createStopwatch(), T0)
    expect(s1).toStrictEqual(start(idle, T0))

    const s2 = toggle(s1, T0 + 3 * SECOND)
    expect(s2).toStrictEqual({ phase: 'paused', accumulated: 3 * SECOND, laps: [] })

    const s3 = toggle(s2, T0 + 10 * SECOND)
    expect(s3).toStrictEqual({
      phase: 'running',
      startedAt: T0 + 10 * SECOND,
      accumulated: 3 * SECOND,
      laps: [],
    })
    expect(elapsed(s3, T0 + 12 * SECOND)).toBe(5 * SECOND)
  })
})

describe('reset', () => {
  it.each(['running', 'paused'] as const)(
    'returns a %s stopwatch to idle, clearing elapsed time and laps',
    (from) => {
      const s = reset(fixtures[from])
      expect(s).toStrictEqual({ phase: 'idle' })
      expect(elapsed(s, T0 + MINUTE)).toBe(0)
      expect(lapDurations(s)).toStrictEqual([])
    },
  )

  it('leaves no laps behind for the next start', () => {
    expect(start(reset(paused), T0 + MINUTE)).toStrictEqual({
      phase: 'running',
      startedAt: T0 + MINUTE,
      accumulated: 0,
      laps: [],
    })
  })
})

describe('lap', () => {
  it('appends the elapsed time as a cumulative split, keeping startedAt and accumulated', () => {
    expect(lap(running, T0 + 3 * SECOND)).toStrictEqual({
      phase: 'running',
      startedAt: T0,
      accumulated: 5 * SECOND,
      laps: [2 * SECOND, 8 * SECOND],
    })
  })

  it('records successive laps as cumulative splits, not lap lengths', () => {
    let s = start(idle, T0)
    s = lap(s, T0 + 1000)
    s = lap(s, T0 + 3500)
    s = lap(s, T0 + 4000)
    expect(splitsOf(s)).toStrictEqual([1000, 3500, 4000])
  })

  it('records a 0 split when pressed at the instant of starting', () => {
    const s = lap(start(idle, T0), T0)
    expect(splitsOf(s)).toStrictEqual([0])
    expect(lapDurations(s)).toStrictEqual([0])
  })

  it('leaves the input laps array untouched', () => {
    const before = start(idle, T0)
    const after = lap(lap(before, T0 + SECOND), T0 + 2 * SECOND)
    expect(splitsOf(before)).toStrictEqual([])
    expect(splitsOf(after)).toStrictEqual([SECOND, 2 * SECOND])
  })

  it('keeps laps across pause and resume, with later splits including the earlier stretch', () => {
    let s = start(idle, T0)
    s = lap(s, T0 + SECOND)
    s = pause(s, T0 + 2 * SECOND)
    s = start(s, T0 + 10 * SECOND)
    s = lap(s, T0 + 11 * SECOND)
    expect(splitsOf(s)).toStrictEqual([SECOND, 3 * SECOND])
    expect(lapDurations(s)).toStrictEqual([SECOND, 2 * SECOND])
    expect(currentLap(s, T0 + 12 * SECOND)).toBe(SECOND)
  })

  it('repeats the previous split (a 0 ms lap) when the clock went back below it', () => {
    let s = start(idle, T0)
    s = lap(s, T0 + 5 * SECOND)
    s = lap(s, T0 + 2 * SECOND)
    expect(splitsOf(s)).toStrictEqual([5 * SECOND, 5 * SECOND])
    expect(lapDurations(s)).toStrictEqual([5 * SECOND, 0])
  })
})

describe('elapsed', () => {
  it.each([T0, T0 + HOUR, Number.NaN])('is 0 when idle (now = %s)', (now) => {
    expect(elapsed(idle, now)).toBe(0)
  })

  it('is the accumulated time plus the current stretch while running', () => {
    expect(elapsed(running, T0 + 2500)).toBe(7500)
  })

  it('is the accumulated time at the instant the stretch started', () => {
    expect(elapsed(running, T0)).toBe(5 * SECOND)
  })

  it.each([T0 - 24 * HOUR, T0, T0 + 24 * HOUR, Number.NaN])(
    'is the frozen accumulated time when paused (now = %s)',
    (now) => {
      expect(elapsed(paused, now)).toBe(7 * SECOND)
    },
  )

  it('clamps the current stretch to 0 when the clock is behind startedAt', () => {
    expect(elapsed(start(idle, T0), T0 - SECOND)).toBe(0)
    expect(elapsed(running, T0 - HOUR)).toBe(5 * SECOND)
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'counts the current stretch as 0 when now is %s',
    (now) => {
      expect(elapsed(running, now)).toBe(5 * SECOND)
    },
  )

  it('is exact for large epoch values', () => {
    const s = start(idle, Date.UTC(2029, 11, 31))
    expect(elapsed(s, Date.UTC(2030, 0, 1))).toBe(24 * HOUR)
    expect(splitsOf(lap(s, Date.UTC(2030, 0, 1, 0, 0, 1)))).toStrictEqual([24 * HOUR + SECOND])
  })
})

describe('lapDurations', () => {
  it('is empty when idle', () => {
    expect(lapDurations(idle)).toStrictEqual([])
  })

  it('is empty before the first lap', () => {
    expect(lapDurations(start(idle, T0))).toStrictEqual([])
  })

  it('subtracts each split from the next, the first lap being its own split', () => {
    const s = frozen({ phase: 'paused', accumulated: 6000, laps: [1000, 2500, 4500] })
    expect(lapDurations(s)).toStrictEqual([1000, 1500, 2000])
  })

  it('works the same while running', () => {
    expect(lapDurations(running)).toStrictEqual([2 * SECOND])
  })
})

describe('currentLap', () => {
  it.each([T0, Number.NaN])('is 0 when idle (now = %s)', (now) => {
    expect(currentLap(idle, now)).toBe(0)
  })

  it('is the whole elapsed time before the first lap', () => {
    const s = start(idle, T0)
    expect(currentLap(s, T0 + 4 * SECOND)).toBe(4 * SECOND)
  })

  it('is the elapsed time since the last split while running', () => {
    expect(currentLap(running, T0 + SECOND)).toBe(4 * SECOND)
  })

  it('is frozen while paused', () => {
    expect(currentLap(paused, T0)).toBe(SECOND)
    expect(currentLap(paused, T0 + HOUR)).toBe(SECOND)
  })

  it('is 0 right after a lap', () => {
    const s = lap(running, T0 + 3 * SECOND)
    expect(currentLap(s, T0 + 3 * SECOND)).toBe(0)
  })

  it('is 0, not negative, when the clock went back below the last split', () => {
    const s = lap(start(idle, T0), T0 + 5 * SECOND)
    expect(currentLap(s, T0 + SECOND)).toBe(0)
  })
})

describe('after the clock went back below the last split', () => {
  it('pause freezes a total below the last split, with the current lap at 0', () => {
    let s = start(idle, T0)
    s = lap(s, T0 + 5 * SECOND)
    s = pause(s, T0 + SECOND)
    expect(s).toStrictEqual({ phase: 'paused', accumulated: SECOND, laps: [5 * SECOND] })
    expect(elapsed(s, T0 + HOUR)).toBe(SECOND)
    expect(lapDurations(s)).toStrictEqual([5 * SECOND])
    expect(currentLap(s, T0 + HOUR)).toBe(0)
  })

  it('after resuming, records 0 ms laps until the total catches up with the last split', () => {
    let s = pause(lap(start(idle, T0), T0 + 5 * SECOND), T0 + SECOND)
    s = start(s, T0 + 10 * SECOND)
    expect(elapsed(s, T0 + 12 * SECOND)).toBe(3 * SECOND)
    expect(currentLap(s, T0 + 12 * SECOND)).toBe(0)

    s = lap(s, T0 + 12 * SECOND)
    expect(splitsOf(s)).toStrictEqual([5 * SECOND, 5 * SECOND])
    expect(lapDurations(s)).toStrictEqual([5 * SECOND, 0])

    expect(elapsed(s, T0 + 16 * SECOND)).toBe(7 * SECOND)
    expect(currentLap(s, T0 + 16 * SECOND)).toBe(2 * SECOND)
  })
})

describe('needsFrames', () => {
  it.each([
    ['running', true],
    ['idle', false],
    ['paused', false],
  ] as const)('is %s → %s', (phase, expected) => {
    expect(needsFrames(fixtures[phase])).toBe(expected)
  })
})

describe('JSON round trip', () => {
  const withLaps = lap(lap(start(idle, T0), T0 + 1234), T0 + 5678)

  it.each([
    ['idle', idle],
    ['running', running],
    ['paused', paused],
    ['running with laps', withLaps],
    ['paused with laps', pause(withLaps, T0 + 9999)],
  ] as const)('%s state survives JSON.stringify and JSON.parse', (_label, s) => {
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
  })
})

describe('properties', () => {
  interface Step {
    readonly op: TransitionName
    /** Clock change since the previous step; negative means the clock went backwards. */
    readonly dt: number
  }
  interface Reading {
    readonly s: StopwatchState
    readonly now: EpochMs
  }

  /** Applies the steps in order from a fresh stopwatch at T0, freezing every input state. */
  function replay(steps: readonly Step[]): Reading[] {
    let s = createStopwatch()
    let now = T0
    const readings: Reading[] = [{ s, now }]
    for (const { op, dt } of steps) {
      now += dt
      s = transitions[op](frozen(s), now)
      readings.push({ s, now })
    }
    return readings
  }

  function stepsOf(ops: readonly TransitionName[], dt: fc.Arbitrary<number>): fc.Arbitrary<Step[]> {
    return fc.array(fc.record({ op: fc.constantFrom(...ops), dt }), { maxLength: 40 })
  }

  const allOps: readonly TransitionName[] = ['start', 'pause', 'toggle', 'lap', 'reset']
  const noReset: readonly TransitionName[] = ['start', 'pause', 'toggle', 'lap']
  const forward = fc.integer({ min: 0, max: HOUR })
  /**
   * A clock that jumps back by up to a minute about half the time, so the backwards clamps in
   * `lap`, `elapsed` and `currentLap` are exercised on most runs, not just occasionally.
   */
  const jittery = fc.oneof(fc.integer({ min: -MINUTE, max: 0 }), fc.integer({ min: 0, max: HOUR }))

  it('elapsed never decreases as time moves forward, for any presses except reset', () => {
    fc.assert(
      fc.property(stepsOf(noReset, forward), (steps) => {
        const readings = replay(steps)
        readings.slice(1).forEach((next, i) => {
          const prev = readings[i]
          if (prev === undefined) throw new Error('unreachable: readings[i] precedes next')
          expect(elapsed(next.s, next.now)).toBeGreaterThanOrEqual(elapsed(prev.s, prev.now))
        })
      }),
    )
  })

  it('no press except reset changes the elapsed reading at the instant it happens', () => {
    fc.assert(
      fc.property(fc.constantFrom(...noReset), stepsOf(allOps, jittery), (op, steps) => {
        for (const { s, now } of replay(steps)) {
          const later = now + SECOND
          expect(elapsed(transitions[op](s, later), later)).toBe(elapsed(s, later))
        }
      }),
    )
  })

  it('lap durations are never negative and sum to the last split, even with a jittery clock', () => {
    fc.assert(
      fc.property(stepsOf(allOps, jittery), (steps) => {
        for (const { s } of replay(steps)) {
          const durations = lapDurations(s)
          expect(durations).toHaveLength(splitsOf(s).length)
          expect(durations.every((d) => d >= 0)).toBe(true)
          expect(sum(durations)).toBe(splitsOf(s).at(-1) ?? 0)
        }
      }),
    )
  })

  it('lap appends the elapsed time, or repeats the last split when the clock went below it', () => {
    fc.assert(
      fc.property(stepsOf(allOps, jittery), jittery, (steps, readDt) => {
        for (const { s, now } of replay(steps)) {
          if (s.phase !== 'running') continue
          const t = now + readDt
          const split = Math.max(elapsed(s, t), s.laps.at(-1) ?? 0)
          const next = lap(frozen(s), t)
          expect(next).toStrictEqual({ ...s, laps: [...s.laps, split] })
          expect(elapsed(next, t)).toBe(elapsed(s, t))
          expect(currentLap(next, t)).toBe(0)
        }
      }),
    )
  })

  it('lap durations plus the current lap add up to elapsed while the clock moves forward', () => {
    fc.assert(
      fc.property(stepsOf(allOps, forward), (steps) => {
        for (const { s, now } of replay(steps)) {
          expect(sum(lapDurations(s)) + currentLap(s, now)).toBe(elapsed(s, now))
        }
      }),
    )
  })

  it('readings are never negative, even with a jittery clock', () => {
    fc.assert(
      fc.property(stepsOf(allOps, jittery), jittery, (steps, readDt) => {
        for (const { s, now } of replay(steps)) {
          expect(elapsed(s, now + readDt)).toBeGreaterThanOrEqual(0)
          expect(currentLap(s, now + readDt)).toBeGreaterThanOrEqual(0)
        }
      }),
    )
  })

  it('every reachable state survives a JSON round trip', () => {
    fc.assert(
      fc.property(stepsOf(allOps, jittery), (steps) => {
        for (const { s } of replay(steps)) {
          expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
        }
      }),
    )
  })
})
