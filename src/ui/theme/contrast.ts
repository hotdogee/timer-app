/**
 * WCAG 2.x contrast math for `#rrggbb` colors. Used to check generated and user-chosen colors.
 */

/** Matches `#rrggbb`, case-insensitive. */
const HEX6 = /^#[0-9a-f]{6}$/i

/** Converts one sRGB channel (0–255) to linear light, per WCAG 2.x. */
function linearChannel(channel: number): number {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * The WCAG relative luminance of a `#rrggbb` color, from 0 (black) to 1 (white).
 * Returns `NaN` for anything else, so a malformed color never passes a contrast check.
 */
export function relativeLuminance(hex: string): number {
  if (!HEX6.test(hex)) return Number.NaN
  const value = Number.parseInt(hex.slice(1), 16)
  const r = linearChannel((value >> 16) & 0xff)
  const g = linearChannel((value >> 8) & 0xff)
  const b = linearChannel(value & 0xff)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * The WCAG contrast ratio between two `#rrggbb` colors, from 1 (identical) to 21 (black on white).
 * Symmetric in its arguments. `NaN` if either color is malformed.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}
