/**
 * Timer presets: named durations that create a timer card in one step (spec › Presets). These are
 * the built-in ones; user presets arrive with settings in M3 and use the same shape.
 */
import type { Ms } from '../core'

/** A named timer duration, e.g. "Tea 3:00". */
export interface Preset {
  /** Stable identity, for menu items and, later, settings. */
  readonly id: string
  /** The new card's name; numbered like default names when taken ("Tea", "Tea 2"). */
  readonly name: string
  /** The new timer's duration. */
  readonly duration: Ms
}

const MINUTE: Ms = 60_000

/** The presets every install has until user presets exist (spec › Presets). Frozen. */
export const BUILTIN_PRESETS: readonly Preset[] = Object.freeze([
  Object.freeze({ id: 'tea', name: 'Tea', duration: 3 * MINUTE }),
  Object.freeze({ id: 'pomodoro', name: 'Pomodoro', duration: 25 * MINUTE }),
  Object.freeze({ id: 'break', name: 'Break', duration: 5 * MINUTE }),
  Object.freeze({ id: 'eggs', name: 'Eggs', duration: 7 * MINUTE }),
])

/** The preset with id `id`, if any. */
export function findPreset(
  id: string,
  presets: readonly Preset[] = BUILTIN_PRESETS,
): Preset | undefined {
  return presets.find((preset) => preset.id === id)
}
