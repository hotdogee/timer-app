/**
 * Pure helpers for the steppers over an idle timer's time (TimerCard): the ▲ and ▼ buttons above
 * and below each field of the readout. The fields come from the readout's own text, so the buttons
 * follow whatever the time style shows (`5:00` has minutes and seconds; `1:30:30` and the fixed
 * style's `00:04:53` add hours), and a press adds or takes away one unit of its field from the
 * whole duration (the engine carries, so `1:00` less a second is `0:59`). A ▼ with less than its
 * unit left is disabled rather than clamping the duration to zero. Kept out of the component so
 * they are unit-tested.
 */
import type { Ms } from '../../core'
import { m } from '../../i18n'

/** The unit of one field of a readout. */
export type DurationUnit = 'hours' | 'minutes' | 'seconds'

/** Which way a stepper moves its field: ▲ adds a unit, ▼ takes one away. */
export type StepDirection = 'up' | 'down'

/** One unit of each field, in milliseconds. */
export const UNIT_MS: Readonly<Record<DurationUnit, Ms>> = {
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1_000,
}

/** One field of a readout: its text as shown (`'05'`) and the unit it counts. */
export interface DurationField {
  readonly text: string
  readonly unit: DurationUnit
}

/** The units of a three-field readout, left to right; a two-field one drops the first. */
const UNITS: readonly DurationUnit[] = ['hours', 'minutes', 'seconds']

/** A field of a duration readout: ASCII digits only (no sign, no centiseconds). */
const FIELD = /^[0-9]+$/

/**
 * The fields of a duration readout, left to right: `'5:00'` is minutes and seconds, `'1:30:30'`
 * and `'00:04:53'` hours, minutes and seconds (units are assigned from the right). Anything that
 * is not two or three runs of digits joined by `:` (a stopwatch's `'0.00'`, overtime's `'−0:12'`,
 * `''`) has no fields: no steppers.
 */
export function durationFields(text: string): DurationField[] {
  const parts = text.split(':')
  if (parts.length < 2 || parts.length > UNITS.length) return []
  if (!parts.every((part) => FIELD.test(part))) return []
  const units = UNITS.slice(UNITS.length - parts.length)
  return units.map((unit, index) => ({ text: parts[index] ?? '', unit }))
}

/**
 * Whether a stepper can move `duration`: ▲ always (the engine saturates at its maximum), ▼ only
 * while a whole unit is left to take away, so ▼ hours on `0:05:00` or ▼ minutes on `0:30` never
 * wipes the duration to `0:00`.
 */
export function canStep(duration: Ms, unit: DurationUnit, direction: StepDirection): boolean {
  return direction === 'up' || duration >= UNIT_MS[unit]
}

/** What one press of a stepper adds to the duration, in milliseconds (negative for ▼). */
export function stepDelta(unit: DurationUnit, direction: StepDirection): number {
  return direction === 'up' ? UNIT_MS[unit] : -UNIT_MS[unit]
}

const LABELS: Readonly<Record<StepDirection, Readonly<Record<DurationUnit, () => string>>>> = {
  up: { hours: m.card_add_hour, minutes: m.card_add_minute, seconds: m.card_add_second },
  down: {
    hours: m.card_subtract_hour,
    minutes: m.card_subtract_minute,
    seconds: m.card_subtract_second,
  },
}

/** A stepper's accessible name and tooltip ("Add a minute"), in the active locale. */
export function stepLabel(unit: DurationUnit, direction: StepDirection): string {
  return LABELS[direction][unit]()
}
