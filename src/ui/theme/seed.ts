/**
 * The theme seed: {@link DEFAULT_SEED}, seed parsing, and picking the seed at startup (the
 * platform accent color when it arrives quickly enough, otherwise the default, so a slow accent
 * lookup never delays the first paint). Free of the color library, so startup can use it without
 * loading the scheme generator.
 */

/** Google blue: the seed when the platform offers no accent color (spec Q20). */
export const DEFAULT_SEED = '#0B57D0'

/** `#rgb` or `#rrggbb`, the `#` optional. */
const SEED_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Normalizes a seed color to lowercase `#rrggbb`. Accepts `#rgb` and `#rrggbb` with or without
 * the `#` and surrounding whitespace; returns `null` for anything else.
 */
export function parseSeed(input: string): string | null {
  const match = SEED_PATTERN.exec(input.trim())
  const digits = match?.[1]?.toLowerCase()
  if (digits === undefined) return null
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits
  return `#${full}`
}

/** Whether `seed` is the default seed in any accepted spelling. */
export function isDefaultSeed(seed: string): boolean {
  return parseSeed(seed) === parseSeed(DEFAULT_SEED)
}

const TIMED_OUT = Symbol('timed out')

/**
 * Resolves the seed color from `accent`, waiting at most `timeoutMs`. Kept for the desktop shell
 * (M5), where the default seed follows the OS accent color (spec Q20); the web has no accent.
 * TODO(M5): call it from main.ts with `platform.accent` and pass the result to
 * `applyAppearance` as `defaultSeed`. A `null`, invalid or failed
 * accent gives {@link DEFAULT_SEED}. When the accent arrives after the timeout, the default is
 * returned and `onLate` later receives the accent (if valid), so the caller can re-theme.
 */
export async function resolveSeed(
  accent: () => Promise<string | null>,
  timeoutMs: number,
  onLate?: (seed: string) => void,
): Promise<string> {
  const fromAccent = Promise.resolve()
    .then(accent)
    .then(
      (value) => (value === null ? null : parseSeed(value)),
      () => null,
    )
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      resolve(TIMED_OUT)
    }, timeoutMs)
  })

  const first = await Promise.race([fromAccent, timeout])
  clearTimeout(timer)
  if (first !== TIMED_OUT) return first ?? DEFAULT_SEED

  if (onLate) {
    void fromAccent.then((seed) => {
      if (seed !== null) onLate(seed)
    })
  }
  return DEFAULT_SEED
}
