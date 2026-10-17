/**
 * Timer presets: named durations that create a timer card in one step (spec › Presets). Presets
 * are user data kept in the synced store (`presets.svelte.ts`); this module holds their shape, the
 * rules for a usable name and duration, and the built-in ones a fresh install starts with.
 */
import { timer, type Ms } from '../core'

/** A named timer duration, e.g. "Tea 3:00". */
export interface Preset {
  /** Stable identity, for menu items, settings and sync. */
  readonly id: string
  /** The new card's name; numbered like default names when taken ("Tea", "Tea 2"). */
  readonly name: string
  /** The new timer's duration. */
  readonly duration: Ms
}

const MINUTE: Ms = 60_000

/**
 * The presets a fresh install starts with (spec › Presets). Frozen. Their ids are fixed, so two
 * devices that both start fresh hold the same preset rows instead of two copies once they sync.
 */
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

/** The longest preset duration: the longest span the engine stores. */
export const MAX_PRESET_DURATION: Ms = timer.MAX_MS

/** A preset name made usable: trimmed, or `null` when nothing is left. */
export function presetName(name: string): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed === '' ? null : trimmed
}

/**
 * Whether `duration` can be a preset's: finite, above 0 and at most {@link MAX_PRESET_DURATION}
 * (the rule an import file's presets follow too).
 */
export function isPresetDuration(duration: Ms): boolean {
  return Number.isFinite(duration) && duration > 0 && duration <= MAX_PRESET_DURATION
}
