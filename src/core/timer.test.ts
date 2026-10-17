import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  addTime,
  createTimer,
  dismiss,
  endTime,
  needsFrames,
  overtime,
  pause,
  progress,
  remaining,
  reset,
  restart,
  setDuration,
  settle,
  snooze,
  start,
  toggle,
} from './timer'
import type { EpochMs, Ms, TimerPhase, TimerState } from './types'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

/** 14:47 UTC on 2026-10-17. Every example happens around this instant. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)
/** The configured duration of the fixture timers: 5:00. */
const D = 5 * MINUTE
/** The largest timestamp a JavaScript Date can hold (+275760-09-13T00:00:00Z). */
const MAX_DATE = Date.UTC(275760, 8, 13)
/** The engine's cap on every span it stores or reads: 8.64e15 ms, the reach of a Date. */
const MAX_MS = 8.64e15

const NON_FINITE = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
const PHASES: readonly TimerPhase[] = ['idle', 'running', 'paused', 'ringing']

const idle = (duration: Ms): TimerState => ({ phase: 'idle', duration })
const running = (duration: Ms, endsAt: EpochMs): TimerState => ({
  phase: 'running',
  duration,
  endsAt,
})
const paused = (duration: Ms, left: Ms): TimerState => ({
  phase: 'paused',
  duration,
  remaining: left,
})
const ringing = (duration: Ms, endedAt: EpochMs): TimerState => ({
  phase: 'ringing',
  duration,
  endedAt,
})

/** One 5:00 timer per phase, as seen at NOW. */
const timers: Record<TimerPhase, TimerState> = {
  idle: idle(D),
  running: running(D, NOW + 3 * MINUTE), // started two minutes ago, three minutes left
  paused: paused(D, 2 * MINUTE),
  ringing: ringing(D, NOW - 12 * SECOND), // has been ringing for 12 seconds
}

describe('transitions from every phase (start, pause, reset, dismiss)', () => {
  const transitions = {
    start: (s: TimerState) => start(s, NOW),
    pause: (s: TimerState) => pause(s, NOW),
    reset: (s: TimerState) => reset(s),
    dismiss: (s: TimerState) => dismiss(s),
  }
  type Transition = keyof typeof transitions

  const noOps: [Transition, TimerPhase][] = [
    ['start', 'running'],
    ['pause', 'idle'],
    ['pause', 'paused'],
    ['pause', 'ringing'],
    ['reset', 'idle'],
    ['dismiss', 'idle'],
    ['dismiss', 'running'],
    ['dismiss', 'paused'],
  ]
  it.each(noOps)('%s on a %s timer returns the same state object', (name, phase) => {
    const s = timers[phase]
    expect(transitions[name](s)).toBe(s)
  })

  const changes: [Transition, TimerPhase, string, TimerState][] = [
    ['start', 'idle', 'runs for the full duration', running(D, NOW + D)],
    ['start', 'paused', 'resumes with the time left', running(D, NOW + 2 * MINUTE)],
    ['start', 'ringing', 'runs again for the full duration', running(D, NOW + D)],
    ['pause', 'running', 'freezes the time left', paused(D, 3 * MINUTE)],
    ['reset', 'running', 'goes idle with the duration', idle(D)],
    ['reset', 'paused', 'goes idle with the duration', idle(D)],
    ['reset', 'ringing', 'goes idle with the duration', idle(D)],
    ['dismiss', 'ringing', 'goes idle with the duration', idle(D)],
  ]
  it.each(changes)('%s on a %s timer %s', (name, phase, _behavior, expected) => {
    expect(transitions[name](timers[phase])).toStrictEqual(expected)
  })
})

describe('createTimer', () => {
  it('creates an idle timer with the given duration', () => {
    expect(createTimer(D)).toStrictEqual(idle(D))
  })

  it('accepts a zero duration', () => {
    expect(createTimer(0)).toStrictEqual(idle(0))
  })

  it.each([...NON_FINITE, -1, -D])('clamps an invalid duration (%s) to 0', (duration) => {
    expect(createTimer(duration)).toStrictEqual(idle(0))
  })

  it('stores negative zero as plain 0', () => {
    expect(Object.is(remaining(createTimer(-0), NOW), 0)).toBe(true)
  })

  it.each([MAX_MS + 1, 1e300, Number.MAX_VALUE])(
    'caps a finite duration (%s) longer than 8.64e15 ms at that length',
    (duration) => {
      expect(createTimer(duration)).toStrictEqual(idle(MAX_MS))
    },
  )
})

describe('start', () => {
  it('runs an idle timer for its full duration from now', () => {
    expect(start(idle(D), NOW)).toStrictEqual(running(D, NOW + D))
  })

  it('leaves an idle timer with a zero duration unchanged', () => {
    const s = idle(0)
    expect(start(s, NOW)).toBe(s)
  })

  it('resumes a paused timer with the time that was left and keeps the duration', () => {
    expect(start(paused(D, 90 * SECOND), NOW)).toStrictEqual(running(D, NOW + 90 * SECOND))
  })

  it('rings from now when resuming a paused timer with no time left', () => {
    expect(start(paused(D, 0), NOW)).toStrictEqual(ringing(D, NOW))
  })

  it('runs a ringing timer again for its full duration (Restart)', () => {
    expect(start(timers.ringing, NOW)).toStrictEqual(running(D, NOW + D))
  })

  it('leaves a ringing timer with a zero duration unchanged', () => {
    const s = ringing(0, NOW - SECOND)
    expect(start(s, NOW)).toBe(s)
  })

  it('leaves a running timer unchanged, even past its end time', () => {
    const s = running(D, NOW - SECOND)
    expect(start(s, NOW)).toBe(s)
  })

  it.each(PHASES)('leaves a %s timer unchanged when now is not finite', (phase) => {
    const s = timers[phase]
    for (const now of NON_FINITE) expect(start(s, now)).toBe(s)
  })
})

describe('pause', () => {
  const endsAt = NOW + 3 * MINUTE

  it('freezes the time left until endsAt', () => {
    expect(pause(running(D, endsAt), endsAt - 45 * SECOND)).toStrictEqual(paused(D, 45 * SECOND))
  })

  it('rings from endsAt when pausing exactly at endsAt', () => {
    expect(pause(running(D, endsAt), endsAt)).toStrictEqual(ringing(D, endsAt))
  })

  it('rings from endsAt, not from now, when pausing after endsAt', () => {
    expect(pause(running(D, endsAt), endsAt + 7 * SECOND)).toStrictEqual(ringing(D, endsAt))
  })

  it.each([0, 7 * SECOND])('matches settle when pausing %s ms after endsAt', (late) => {
    const s = running(D, endsAt)
    expect(pause(s, endsAt + late)).toStrictEqual(settle(s, endsAt + late))
  })

  it('keeps a positive time left when the clock went back before the start', () => {
    const startedAt = endsAt - D
    const s = pause(running(D, endsAt), startedAt - MINUTE)
    expect(s).toStrictEqual(paused(D, D + MINUTE))
    expect(progress(s, startedAt - MINUTE)).toBe(0)
  })

  it('saturates the time left when the clock jumps back across the whole number range', () => {
    const s = start(idle(D), Number.MAX_VALUE) // endsAt rounds to MAX_VALUE
    expect(pause(s, -Number.MAX_VALUE)).toStrictEqual(paused(D, MAX_MS))
  })

  it.each(PHASES)('leaves a %s timer unchanged when now is not finite', (phase) => {
    const s = timers[phase]
    for (const now of NON_FINITE) expect(pause(s, now)).toBe(s)
  })
})

describe('toggle (Space)', () => {
  it('starts an idle timer', () => {
    expect(toggle(idle(D), NOW)).toStrictEqual(running(D, NOW + D))
  })

  it('pauses a running timer', () => {
    expect(toggle(timers.running, NOW)).toStrictEqual(paused(D, 3 * MINUTE))
  })

  it('resumes a paused timer', () => {
    expect(toggle(timers.paused, NOW)).toStrictEqual(running(D, NOW + 2 * MINUTE))
  })

  it('dismisses a ringing timer', () => {
    expect(toggle(timers.ringing, NOW)).toStrictEqual(idle(D))
  })

  it('rings a running timer that is past its end, from endsAt', () => {
    expect(toggle(running(D, NOW - SECOND), NOW)).toStrictEqual(ringing(D, NOW - SECOND))
  })

  it('rings a paused timer with no time left', () => {
    expect(toggle(paused(D, 0), NOW)).toStrictEqual(ringing(D, NOW))
  })

  it('leaves an idle timer with a zero duration unchanged', () => {
    const s = idle(0)
    expect(toggle(s, NOW)).toBe(s)
  })

  it('cycles idle → running → paused → running and keeps the time left across the pause', () => {
    const t0 = Date.UTC(2030, 0, 1, 9, 0, 0)
    const started = toggle(createTimer(D), t0)
    expect(started).toStrictEqual(running(D, t0 + D))

    const pausedAt = toggle(started, t0 + MINUTE)
    expect(pausedAt).toStrictEqual(paused(D, 4 * MINUTE))

    const resumed = toggle(pausedAt, t0 + 10 * MINUTE)
    expect(resumed).toStrictEqual(running(D, t0 + 14 * MINUTE))
    expect(remaining(resumed, t0 + 12 * MINUTE)).toBe(2 * MINUTE)
  })
})

describe('restart', () => {
  it('runs a ringing timer again for its full duration from now', () => {
    expect(restart(timers.ringing, NOW)).toStrictEqual(running(D, NOW + D))
  })

  it('leaves a ringing timer with a zero duration unchanged', () => {
    const s = ringing(0, NOW)
    expect(restart(s, NOW)).toBe(s)
  })

  it.each(['idle', 'running', 'paused'] as const)('leaves a %s timer unchanged', (phase) => {
    const s = timers[phase]
    expect(restart(s, NOW)).toBe(s)
  })

  it('leaves a ringing timer unchanged when now is not finite', () => {
    const s = timers.ringing
    for (const now of NON_FINITE) expect(restart(s, now)).toBe(s)
  })
})

describe('setDuration', () => {
  it('sets a new duration on an idle timer', () => {
    expect(setDuration(idle(D), 90 * SECOND)).toStrictEqual(idle(90 * SECOND))
  })

  it('returns the same idle timer when the duration is unchanged', () => {
    const s = idle(D)
    expect(setDuration(s, D)).toBe(s)
  })

  it.each([...NON_FINITE, -1, -0])(
    'returns the same zero-length idle timer for %s, which clamps to 0',
    (duration) => {
      const s = idle(0)
      expect(setDuration(s, duration)).toBe(s)
    },
  )

  it.each([...NON_FINITE, -SECOND])('clamps an invalid duration (%s) to 0', (duration) => {
    expect(setDuration(idle(D), duration)).toStrictEqual(idle(0))
  })

  it('caps a duration longer than 8.64e15 ms, and returns the same timer if already capped', () => {
    expect(setDuration(idle(D), Number.MAX_VALUE)).toStrictEqual(idle(MAX_MS))
    const capped = idle(MAX_MS)
    expect(setDuration(capped, 1e300)).toBe(capped)
  })

  it('leaves a running timer unchanged', () => {
    const s = timers.running
    expect(setDuration(s, 10 * MINUTE)).toBe(s)
  })

  it('resets a paused timer to idle with the new duration', () => {
    expect(setDuration(timers.paused, 10 * MINUTE)).toStrictEqual(idle(10 * MINUTE))
  })

  it('resets a paused timer to idle even when the duration is the same', () => {
    expect(setDuration(timers.paused, D)).toStrictEqual(idle(D))
  })

  it('dismisses a ringing timer into idle with the new duration', () => {
    expect(setDuration(timers.ringing, 10 * MINUTE)).toStrictEqual(idle(10 * MINUTE))
  })

  it('dismisses a ringing timer even when the duration is the same', () => {
    expect(setDuration(timers.ringing, D)).toStrictEqual(idle(D))
  })
})

describe('addTime (quick-add chips)', () => {
  describe('idle', () => {
    it('lengthens the duration', () => {
      expect(addTime(idle(D), 30 * SECOND, NOW)).toStrictEqual(idle(D + 30 * SECOND))
    })

    it('shortens the duration', () => {
      expect(addTime(idle(D), -MINUTE, NOW)).toStrictEqual(idle(4 * MINUTE))
    })

    it('floors the duration at 0', () => {
      expect(addTime(idle(D), -10 * MINUTE, NOW)).toStrictEqual(idle(0))
    })

    it('returns the same timer when the duration is already 0 and delta is negative', () => {
      const s = idle(0)
      expect(addTime(s, -MINUTE, NOW)).toBe(s)
    })

    it('does not read now', () => {
      expect(addTime(idle(D), MINUTE, Number.NaN)).toStrictEqual(idle(D + MINUTE))
    })

    it('saturates the duration at 8.64e15 ms instead of overflowing', () => {
      expect(addTime(idle(D), Number.MAX_VALUE, NOW)).toStrictEqual(idle(MAX_MS))
    })

    it('returns the same timer when the duration is already saturated', () => {
      const s = createTimer(Number.MAX_VALUE)
      expect(addTime(s, Number.MAX_VALUE, NOW)).toBe(s)
    })
  })

  describe('running (3:00 left of 5:00)', () => {
    const s = timers.running

    it('extends both the end time and the duration, so the ring rescales', () => {
      const next = addTime(s, MINUTE, NOW)
      expect(next).toStrictEqual(running(D + MINUTE, NOW + 4 * MINUTE))
      expect(progress(s, NOW)).toBeCloseTo(2 / 5)
      expect(progress(next, NOW)).toBeCloseTo(2 / 6)
    })

    it('shortens a timer that still ends after now', () => {
      expect(addTime(s, -MINUTE, NOW)).toStrictEqual(running(4 * MINUTE, NOW + 2 * MINUTE))
    })

    it('rings from now when subtracting exactly the time left', () => {
      expect(addTime(s, -3 * MINUTE, NOW)).toStrictEqual(ringing(2 * MINUTE, NOW))
    })

    it('rings from now, with the duration floored at 0, when subtracting past now', () => {
      const next = addTime(s, -10 * MINUTE, NOW)
      expect(next).toStrictEqual(ringing(0, NOW))
      expect(overtime(next, NOW)).toBe(0)
    })

    it('keeps an overdue timer running when the added time moves its end past now', () => {
      const overdue = running(D, NOW - SECOND)
      expect(addTime(overdue, 30 * SECOND, NOW)).toStrictEqual(
        running(D + 30 * SECOND, NOW + 29 * SECOND),
      )
    })

    it('returns the same timer when now is not finite', () => {
      for (const now of NON_FINITE) expect(addTime(s, MINUTE, now)).toBe(s)
    })

    it('saturates the duration and the time left at 8.64e15 ms', () => {
      expect(addTime(s, Number.MAX_VALUE, NOW)).toStrictEqual(running(MAX_MS, NOW + MAX_MS))
    })

    it('returns the same timer when a saturated timer gets more time at the same instant', () => {
      const full = start(createTimer(1e308), NOW)
      expect(full).toStrictEqual(running(MAX_MS, NOW + MAX_MS))
      expect(addTime(full, 1e308, NOW)).toBe(full)
    })

    it('returns the same timer for a delta too small to move the end time', () => {
      expect(addTime(s, 1e-20, NOW)).toBe(s)
    })

    it('still saturates the duration when the end time is already at the cap', () => {
      const snoozed = snooze(timers.ringing, Number.MAX_VALUE, NOW)
      expect(snoozed).toStrictEqual(running(D, NOW + MAX_MS))
      expect(addTime(snoozed, Number.MAX_VALUE, NOW)).toStrictEqual(running(MAX_MS, NOW + MAX_MS))
    })

    it('still moves the end time when the duration is already saturated', () => {
      const full = start(createTimer(MAX_MS), NOW)
      expect(addTime(full, MINUTE, NOW + HOUR)).toStrictEqual(
        running(MAX_MS, NOW + MAX_MS + MINUTE),
      )
    })
  })

  describe('paused (2:00 left of 5:00)', () => {
    const s = timers.paused

    it('adds to both the duration and the time left', () => {
      expect(addTime(s, 30 * SECOND, NOW)).toStrictEqual(
        paused(D + 30 * SECOND, 2 * MINUTE + 30 * SECOND),
      )
    })

    it('subtracts from both the duration and the time left', () => {
      expect(addTime(s, -MINUTE, NOW)).toStrictEqual(paused(4 * MINUTE, MINUTE))
    })

    it('floors the time left at 0 without ringing', () => {
      expect(addTime(s, -3 * MINUTE, NOW)).toStrictEqual(paused(2 * MINUTE, 0))
    })

    it('floors both at 0', () => {
      expect(addTime(s, -10 * MINUTE, NOW)).toStrictEqual(paused(0, 0))
    })

    it('returns the same timer when both are already 0 and delta is negative', () => {
      const empty = paused(0, 0)
      expect(addTime(empty, -SECOND, NOW)).toBe(empty)
    })

    it('shortens the duration when only the time left is already 0', () => {
      expect(addTime(paused(D, 0), -MINUTE, NOW)).toStrictEqual(paused(4 * MINUTE, 0))
    })

    it('takes the time left to 0 when only the duration is already 0', () => {
      // Reachable: snooze a zero-length ringing timer, then pause it.
      expect(addTime(paused(0, 30 * SECOND), -MINUTE, NOW)).toStrictEqual(paused(0, 0))
    })

    it('saturates both at 8.64e15 ms', () => {
      expect(addTime(s, Number.MAX_VALUE, NOW)).toStrictEqual(paused(MAX_MS, MAX_MS))
    })

    it('does not read now', () => {
      expect(addTime(s, MINUTE, Number.NaN)).toStrictEqual(paused(D + MINUTE, 3 * MINUTE))
    })
  })

  describe('ringing', () => {
    it.each([30 * SECOND, -30 * SECOND])('returns the same timer for delta %s', (delta) => {
      const s = timers.ringing
      expect(addTime(s, delta, NOW)).toBe(s)
    })
  })

  it.each(PHASES)('returns the same %s timer for a non-finite delta', (phase) => {
    const s = timers[phase]
    for (const delta of NON_FINITE) expect(addTime(s, delta, NOW)).toBe(s)
  })

  it.each(PHASES)('returns the same %s timer for a zero delta', (phase) => {
    const s = timers[phase]
    expect(addTime(s, 0, NOW)).toBe(s)
  })

  it('leaves an overdue running timer for settle to date when delta is 0', () => {
    const overdue = running(D, NOW - 5 * SECOND)
    expect(addTime(overdue, 0, NOW)).toBe(overdue)
    expect(settle(overdue, NOW)).toStrictEqual(ringing(D, NOW - 5 * SECOND))
  })
})

describe('snooze', () => {
  it('runs a ringing timer for the snooze length from now and keeps its duration', () => {
    expect(snooze(timers.ringing, MINUTE, NOW)).toStrictEqual(running(D, NOW + MINUTE))
  })

  it('keeps the original duration, so Reset returns to it', () => {
    expect(reset(snooze(timers.ringing, MINUTE, NOW))).toStrictEqual(idle(D))
  })

  it('rings again when the snooze runs out', () => {
    const snoozed = snooze(timers.ringing, MINUTE, NOW)
    expect(settle(snoozed, NOW + MINUTE)).toStrictEqual(ringing(D, NOW + MINUTE))
  })

  it('reads the snooze length as remaining even when it exceeds the duration', () => {
    const snoozed = snooze(timers.ringing, 10 * MINUTE, NOW)
    expect(remaining(snoozed, NOW)).toBe(10 * MINUTE)
    expect(progress(snoozed, NOW)).toBe(0)
  })

  it('caps the snooze length at 8.64e15 ms', () => {
    expect(snooze(timers.ringing, Number.MAX_VALUE, NOW)).toStrictEqual(running(D, NOW + MAX_MS))
  })

  it.each([0, -MINUTE, ...NON_FINITE])('ignores a snooze length of %s', (delta) => {
    const s = timers.ringing
    expect(snooze(s, delta, NOW)).toBe(s)
  })

  it.each(['idle', 'running', 'paused'] as const)('leaves a %s timer unchanged', (phase) => {
    const s = timers[phase]
    expect(snooze(s, MINUTE, NOW)).toBe(s)
  })

  it('leaves a ringing timer unchanged when now is not finite', () => {
    const s = timers.ringing
    for (const now of NON_FINITE) expect(snooze(s, MINUTE, now)).toBe(s)
  })
})

describe('settle', () => {
  const endsAt = NOW + 3 * MINUTE
  const s = running(D, endsAt)

  it('returns the same running timer before endsAt', () => {
    expect(settle(s, endsAt - 1)).toBe(s)
  })

  it('rings exactly at endsAt', () => {
    expect(settle(s, endsAt)).toStrictEqual(ringing(D, endsAt))
  })

  it('dates the ring from endsAt when settled late, so overtime counts from the real end', () => {
    const late = settle(s, endsAt + 7 * SECOND)
    expect(late).toStrictEqual(ringing(D, endsAt))
    expect(overtime(late, endsAt + 7 * SECOND)).toBe(7 * SECOND)
  })

  it('returns the same running timer when the clock went back before the start', () => {
    expect(settle(s, endsAt - D - MINUTE)).toBe(s)
  })

  it('returns the same running timer for a NaN now', () => {
    expect(settle(s, Number.NaN)).toBe(s)
  })

  it.each(['idle', 'paused', 'ringing'] as const)('returns the same %s timer', (phase) => {
    const t = timers[phase]
    expect(settle(t, NOW + HOUR)).toBe(t)
  })

  it('returns the settled timer itself when settled again', () => {
    const once = settle(s, endsAt + SECOND)
    expect(settle(once, endsAt + SECOND)).toBe(once)
  })
})

describe('remaining', () => {
  const endsAt = NOW + 3 * MINUTE

  it('reads the duration of an idle timer', () => {
    expect(remaining(idle(D), NOW)).toBe(D)
  })

  it('counts down a running timer to endsAt', () => {
    expect(remaining(running(D, endsAt), endsAt - 45 * SECOND)).toBe(45 * SECOND)
  })

  it('reads 0 exactly at endsAt', () => {
    expect(remaining(running(D, endsAt), endsAt)).toBe(0)
  })

  it('clamps at 0 for a running timer past endsAt that is not settled yet', () => {
    expect(remaining(running(D, endsAt), endsAt + HOUR)).toBe(0)
  })

  it('stays positive when the clock went back before the start', () => {
    expect(remaining(running(D, endsAt), endsAt - D - MINUTE)).toBe(D + MINUTE)
  })

  it('reads the frozen time left of a paused timer at any time', () => {
    expect(remaining(timers.paused, NOW)).toBe(2 * MINUTE)
    expect(remaining(timers.paused, NOW + HOUR)).toBe(2 * MINUTE)
  })

  it('reads 0 for a ringing timer', () => {
    expect(remaining(timers.ringing, NOW)).toBe(0)
  })

  it('reads 0, not NaN, for a running timer at a NaN now', () => {
    expect(remaining(timers.running, Number.NaN)).toBe(0)
  })

  it('saturates at 8.64e15 ms, not Infinity, for a running timer at a now of -Infinity', () => {
    expect(remaining(timers.running, Number.NEGATIVE_INFINITY)).toBe(MAX_MS)
  })
})

describe('overtime', () => {
  const endedAt = NOW - 12 * SECOND

  it('counts up from endedAt while ringing', () => {
    expect(overtime(ringing(D, endedAt), NOW)).toBe(12 * SECOND)
  })

  it('reads 0 at the moment the timer starts ringing', () => {
    expect(overtime(ringing(D, endedAt), endedAt)).toBe(0)
  })

  it('reads 0, not a negative value, when the clock went back before endedAt', () => {
    expect(overtime(ringing(D, endedAt), endedAt - MINUTE)).toBe(0)
  })

  it('reads 0 for a running timer past its end that is not settled yet', () => {
    expect(overtime(running(D, endedAt), NOW)).toBe(0)
  })

  it.each(['idle', 'paused'] as const)('reads 0 for a %s timer', (phase) => {
    expect(overtime(timers[phase], NOW)).toBe(0)
  })

  it('reads 0, not NaN, for a ringing timer at a NaN now', () => {
    expect(overtime(ringing(D, endedAt), Number.NaN)).toBe(0)
  })

  it('saturates at 8.64e15 ms, not Infinity, for a ringing timer at a now of Infinity', () => {
    expect(overtime(ringing(D, endedAt), Number.POSITIVE_INFINITY)).toBe(MAX_MS)
  })
})

describe('progress', () => {
  const startedAt = NOW
  const s = running(D, startedAt + D)

  it('reads 0 for an idle timer, whatever its duration', () => {
    expect(progress(idle(D), NOW)).toBe(0)
    expect(progress(idle(0), NOW)).toBe(0)
  })

  it('reads 0 at the start of a run', () => {
    expect(progress(s, startedAt)).toBe(0)
  })

  it('reads 0.5 halfway through', () => {
    expect(progress(s, startedAt + D / 2)).toBe(0.5)
  })

  it('reads 1 at endsAt', () => {
    expect(progress(s, startedAt + D)).toBe(1)
  })

  it('clamps to 1 past endsAt', () => {
    expect(progress(s, startedAt + D + HOUR)).toBe(1)
  })

  it('clamps to 0 when the clock went back before the start', () => {
    expect(progress(s, startedAt - MINUTE)).toBe(0)
  })

  it('reads the elapsed fraction of a paused timer', () => {
    expect(progress(paused(D, 2 * MINUTE), NOW)).toBeCloseTo(0.6)
  })

  it('reads 1 for a paused timer with a zero duration', () => {
    expect(progress(paused(0, 0), NOW)).toBe(1)
  })

  it('reads 1 for a running timer with a zero duration (a snoozed zero-length timer)', () => {
    const snoozed = snooze(ringing(0, NOW), MINUTE, NOW)
    expect(snoozed).toStrictEqual(running(0, NOW + MINUTE))
    expect(progress(snoozed, NOW)).toBe(1)
  })

  it('reads 1 for a ringing timer', () => {
    expect(progress(timers.ringing, NOW)).toBe(1)
  })
})

describe('endTime', () => {
  it('reads endsAt for a running timer', () => {
    expect(endTime(timers.running)).toBe(NOW + 3 * MINUTE)
  })

  it.each(['idle', 'paused', 'ringing'] as const)('is null for a %s timer', (phase) => {
    expect(endTime(timers[phase])).toBeNull()
  })
})

describe('needsFrames', () => {
  it.each([
    { phase: 'idle', expected: false },
    { phase: 'running', expected: true },
    { phase: 'paused', expected: false },
    { phase: 'ringing', expected: true },
  ] as const)('is $expected for a $phase timer', ({ phase, expected }) => {
    expect(needsFrames(timers[phase])).toBe(expected)
  })
})

describe('JSON round trip', () => {
  const t0 = Date.UTC(2030, 0, 1, 9, 0, 0)
  const runningTimer = start(createTimer(D), t0)
  const reached: Record<TimerPhase, TimerState> = {
    idle: createTimer(D),
    running: runningTimer,
    paused: pause(runningTimer, t0 + MINUTE),
    ringing: settle(runningTimer, t0 + D + SECOND),
  }

  it.each(PHASES)('a %s timer survives JSON.stringify and JSON.parse', (phase) => {
    const s = reached[phase]
    expect(s.phase).toBe(phase)
    expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
  })

  it('states built from invalid or extreme inputs stay JSON-safe', () => {
    const states = [
      createTimer(Number.NaN),
      setDuration(idle(D), Number.POSITIVE_INFINITY),
      addTime(timers.paused, -HOUR, NOW),
      addTime(timers.running, -HOUR, NOW),
      start(paused(D, 0), NOW),
      addTime(createTimer(Number.MAX_VALUE), Number.MAX_VALUE, NOW),
      addTime(addTime(timers.running, Number.MAX_VALUE, NOW), Number.MAX_VALUE, NOW),
      addTime(timers.paused, Number.MAX_VALUE, NOW),
      snooze(timers.ringing, Number.MAX_VALUE, Number.MAX_VALUE),
      pause(start(idle(D), Number.MAX_VALUE), -Number.MAX_VALUE),
    ]
    for (const s of states) expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
  })
})

describe('large clock values', () => {
  it.each([
    ['2030-01-01', Date.UTC(2030, 0, 1)],
    ['the largest valid Date minus a day', MAX_DATE - 24 * HOUR],
  ])('counts down to the millisecond at %s', (_label, t0) => {
    const s = start(createTimer(D), t0)
    expect(remaining(s, t0 + 1)).toBe(D - 1)
    expect(remaining(s, t0 + D - 1)).toBe(1)
    expect(settle(s, t0 + D)).toStrictEqual(ringing(D, t0 + D))
    expect(overtime(settle(s, t0 + D), t0 + D + 12 * SECOND)).toBe(12 * SECOND)
  })
})

/* ------------------------------------------------------------------------------------------ */
/* Property-based tests                                                                         */
/* ------------------------------------------------------------------------------------------ */

type Op =
  | { readonly kind: 'start' | 'pause' | 'toggle' | 'reset' | 'dismiss' | 'restart' | 'settle' }
  | { readonly kind: 'setDuration'; readonly duration: number }
  | { readonly kind: 'addTime' | 'snooze'; readonly delta: number }

interface Step {
  readonly op: Op
  /** Milliseconds the clock moves forward before the op runs (0 allowed). */
  readonly advance: Ms
  /** A non-finite `now` to pass to the op instead of the clock, if set. */
  readonly junkNow?: number | undefined
}

function apply(s: TimerState, op: Op, now: EpochMs): TimerState {
  switch (op.kind) {
    case 'start':
      return start(s, now)
    case 'pause':
      return pause(s, now)
    case 'toggle':
      return toggle(s, now)
    case 'reset':
      return reset(s)
    case 'dismiss':
      return dismiss(s)
    case 'restart':
      return restart(s, now)
    case 'settle':
      return settle(s, now)
    case 'setDuration':
      return setDuration(s, op.duration)
    case 'addTime':
      return addTime(s, op.delta, now)
    case 'snooze':
      return snooze(s, op.delta, now)
  }
}

/** Replays `steps` on a new timer from `t0` and returns every state it passes through. */
function replay(initial: number, t0: EpochMs, steps: readonly Step[]): TimerState[] {
  let s = createTimer(initial)
  let now = t0
  const states = [s]
  for (const { op, advance, junkNow } of steps) {
    now += advance
    s = apply(s, op, junkNow ?? now)
    states.push(s)
  }
  return states
}

const nonFiniteArb = fc.constantFrom(...NON_FINITE)

/** Finite numbers far past any real span, and fractions too small to move a timestamp. */
const extremeArb = fc.constantFrom(
  Number.MAX_VALUE,
  -Number.MAX_VALUE,
  1e300,
  -1e300,
  1e-20,
  -1e-20,
)

/**
 * Durations: mostly whole milliseconds up to 1 h, so a timer often runs out within a sequence;
 * sometimes 0 or up to 10 h; rarely values the engine must clamp to 0 or saturate.
 */
const durationArb = fc.oneof(
  { weight: 12, arbitrary: fc.integer({ min: 1, max: HOUR }) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 10 * HOUR }) },
  { weight: 1, arbitrary: fc.oneof(nonFiniteArb, fc.integer({ min: -HOUR, max: -1 })) },
  { weight: 1, arbitrary: extremeArb },
)

/** Whole-millisecond deltas of up to ±2 h; rarely non-finite (ignored) or extreme (saturated). */
const deltaArb = fc.oneof(
  { weight: 8, arbitrary: fc.integer({ min: -2 * HOUR, max: 2 * HOUR }) },
  { weight: 1, arbitrary: nonFiniteArb },
  { weight: 1, arbitrary: extremeArb },
)

/** Clock readings between 2000 and 2100, whole milliseconds like Date.now(). */
const epochArb = fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2100, 0, 1) })

/** Non-decreasing clock steps: often none, usually short, sometimes long enough to ring. */
const advanceArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 0, max: 10 * MINUTE }),
  fc.integer({ min: 0, max: 3 * HOUR }),
)

/**
 * Operations, weighted so that sequences keep leaving idle: the ops that start or resume a
 * timer come up most, the ones that send it back to idle least.
 */
function opArb(withSnooze: boolean): fc.Arbitrary<Op> {
  const ops: fc.WeightedArbitrary<Op>[] = [
    {
      weight: 6,
      arbitrary: fc.constantFrom<Op>({ kind: 'start' }, { kind: 'toggle' }, { kind: 'restart' }),
    },
    { weight: 4, arbitrary: fc.constantFrom<Op>({ kind: 'pause' }, { kind: 'settle' }) },
    { weight: 1, arbitrary: fc.constantFrom<Op>({ kind: 'reset' }, { kind: 'dismiss' }) },
    {
      weight: 1,
      arbitrary: durationArb.map((duration): Op => ({ kind: 'setDuration', duration })),
    },
    { weight: 2, arbitrary: deltaArb.map((delta): Op => ({ kind: 'addTime', delta })) },
  ]
  if (withSnooze) {
    ops.push({ weight: 1, arbitrary: deltaArb.map((delta): Op => ({ kind: 'snooze', delta })) })
  }
  return fc.oneof(...ops)
}

/**
 * Sequence lengths. fast-check's default size caps arrays at 10 elements whatever `maxLength`
 * says; `size: 'max'` lets them use the whole range.
 */
const SEQUENCE: fc.ArrayConstraints = { minLength: 1, maxLength: 40, size: 'max' }

function stepsArb(withSnooze: boolean): fc.Arbitrary<Step[]> {
  return fc.array(fc.record({ op: opArb(withSnooze), advance: advanceArb }), SEQUENCE)
}

/** Like `stepsArb(true)`, but about one op in ten runs at a non-finite `now`. */
const junkStepsArb: fc.Arbitrary<Step[]> = fc.array(
  fc.record({
    op: opArb(true),
    advance: advanceArb,
    junkNow: fc.oneof(
      { weight: 9, arbitrary: fc.constant(undefined) },
      { weight: 1, arbitrary: nonFiniteArb },
    ),
  }),
  SEQUENCE,
)

describe('properties', () => {
  it.each([
    ['without snooze', stepsArb(false)],
    ['with snooze', stepsArb(true)],
    ['with non-finite now', junkStepsArb],
  ])('sequences %s reach every phase in at least a third of the runs', (_label, steps) => {
    // Guards the arbitraries themselves: properties that only ever see idle prove little.
    const runs = fc.sample(fc.tuple(durationArb, epochArb, steps), 300)
    for (const phase of PHASES) {
      const reached = runs.filter(([initial, t0, ops]) =>
        replay(initial, t0, ops).some((s) => s.phase === phase),
      )
      expect(reached.length, `runs that reach ${phase}`).toBeGreaterThanOrEqual(runs.length / 3)
    }
  })

  it('remaining stays within [0, duration] for any operations with a non-decreasing clock', () => {
    // Snooze is left out on purpose: it may run longer than the configured duration (spec ›
    // Time's up), which is covered by the next property.
    fc.assert(
      fc.property(durationArb, epochArb, stepsArb(false), (initial, t0, steps) => {
        const expectWithinDuration = (state: TimerState, at: EpochMs) => {
          const left = remaining(state, at)
          expect(left).toBeGreaterThanOrEqual(0)
          expect(left).toBeLessThanOrEqual(state.duration)
        }
        let s = createTimer(initial)
        let now = t0
        expectWithinDuration(s, now)
        for (const { op, advance } of steps) {
          now += advance
          expectWithinDuration(s, now) // the clock moved on
          s = apply(s, op, now)
          expectWithinDuration(s, now) // the operation ran
        }
      }),
      { numRuns: 300 },
    )
  })

  it('readings are finite, never negative, and progress stays in [0, 1], snooze included', () => {
    fc.assert(
      fc.property(durationArb, epochArb, stepsArb(true), (initial, t0, steps) => {
        let s = createTimer(initial)
        let now = t0
        for (const { op, advance } of steps) {
          now += advance
          s = apply(s, op, now)
          for (const reading of [remaining(s, now), overtime(s, now)]) {
            expect(Number.isFinite(reading)).toBe(true)
            expect(reading).toBeGreaterThanOrEqual(0)
          }
          const fraction = progress(s, now)
          expect(fraction).toBeGreaterThanOrEqual(0)
          expect(fraction).toBeLessThanOrEqual(1)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('settle is idempotent at any time, including before the timer started', () => {
    fc.assert(
      fc.property(
        durationArb,
        epochArb,
        stepsArb(true),
        fc.integer({ min: -3 * HOUR, max: 3 * HOUR }),
        (initial, t0, steps, offset) => {
          let s = createTimer(initial)
          let now = t0
          for (const { op, advance } of steps) {
            now += advance
            s = apply(s, op, now)
            const once = settle(s, now + offset)
            expect(settle(once, now + offset)).toBe(once)
          }
        },
      ),
      { numRuns: 300 },
    )
  })

  it('every reachable state survives a JSON round trip, even with junk or extreme inputs', () => {
    fc.assert(
      fc.property(durationArb, epochArb, junkStepsArb, (initial, t0, steps) => {
        for (const s of replay(initial, t0, steps)) {
          expect(JSON.parse(JSON.stringify(s))).toStrictEqual(s)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('an operation that changes nothing returns the input state itself', () => {
    fc.assert(
      fc.property(durationArb, epochArb, stepsArb(true), (initial, t0, steps) => {
        let s = createTimer(initial)
        let now = t0
        for (const { op, advance } of steps) {
          now += advance
          const next = apply(s, op, now)
          if (next !== s) {
            expect(next, `${op.kind} returned a new but equal state`).not.toStrictEqual(s)
          }
          s = next
        }
      }),
      { numRuns: 300 },
    )
  })
})
