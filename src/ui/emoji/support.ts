/**
 * Which emoji the system can draw. The picker's data goes up to the newest Unicode emoji version,
 * but an older system's emoji font lacks the newest emoji, which would show as empty boxes or as
 * their parts side by side; the picker leaves those versions out.
 *
 * Each version from 11 on has a probe (scripts/emoji-data.mjs), drawn once on a 1×1 canvas in the
 * emoji font (`--font-emoji`, tokens.css). A single code point is drawn at 100px scaled into the
 * one pixel, which a color emoji tints, while a missing glyph (a box in the black fill) or nothing
 * at all leaves it black or empty. A ZWJ sequence counts as drawn when it is narrower than one and
 * a half times its first code point, i.e. not drawn as its parts. Versions only add emoji, so once
 * a probe fails, its version and every later one are out. A system whose emoji font has no color
 * (some Linux setups) thus loses Emoji 11 and later; a canvas that cannot tell (no 2D context, as
 * in jsdom, or one that throws) leaves everything in. Results last for the page's life.
 */
import type { EmojiProbe } from './data'

/** tokens.css › `--font-emoji`, for a page without the property (the tests). */
export const EMOJI_FONT_STACK =
  "'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', sans-serif"

/** What a probe needs of a 2D canvas context; a `CanvasRenderingContext2D` is one. */
export interface ProbeContext {
  font: string
  textBaseline: CanvasTextBaseline
  fillStyle: string | CanvasGradient | CanvasPattern
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  scale(x: number, y: number): void
  clearRect(x: number, y: number, width: number, height: number): void
  fillText(text: string, x: number, y: number): void
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { readonly data: ArrayLike<number> }
  measureText(text: string): { readonly width: number }
}

/** What a probe needs of a canvas: its 2D context, or null where it has none (jsdom). */
export interface ProbeCanvas {
  getContext(contextId: '2d', options?: { willReadFrequently?: boolean }): ProbeContext | null
}

/** Whether each probe drew on this page's canvas, by version and emoji. */
const pageResults = new Map<string, boolean>()

/** The page's 1×1 probe canvas, made on first use; null where there is no document. */
let pageCanvas: ProbeCanvas | null | undefined

function defaultCanvas(): ProbeCanvas | null {
  if (pageCanvas === undefined) {
    if (typeof document === 'undefined') {
      pageCanvas = null
    } else {
      const canvas = document.createElement('canvas')
      canvas.width = 1
      canvas.height = 1
      pageCanvas = canvas
    }
  }
  return pageCanvas
}

/** The page's emoji font stack (tokens.css), or {@link EMOJI_FONT_STACK} without one. */
function fontStack(): string {
  if (typeof document === 'undefined') return EMOJI_FONT_STACK
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-emoji').trim()
  return value === '' ? EMOJI_FONT_STACK : value
}

/**
 * Whether `probe` draws as one color emoji on `context` in the font stack `font` (see the module
 * notes). A canvas that throws counts as drawing it: what cannot be told stays in.
 */
export function drawsProbe(context: ProbeContext, probe: EmojiProbe, font: string): boolean {
  try {
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.font = `100px ${font}`
    if (probe.base !== undefined) {
      return context.measureText(probe.emoji).width < 1.5 * context.measureText(probe.base).width
    }
    context.clearRect(0, 0, 1, 1)
    context.textBaseline = 'top'
    context.fillStyle = '#000'
    context.scale(0.01, 0.01)
    context.fillText(probe.emoji, 0, 0)
    const { data } = context.getImageData(0, 0, 1, 1)
    const color = (data[0] ?? 0) + (data[1] ?? 0) + (data[2] ?? 0)
    return (data[3] ?? 0) > 0 && color > 0
  } catch {
    return true
  }
}

/**
 * The emoji versions the system cannot draw: the version of the first probe (in version order)
 * that does not draw, and every later probe's. Empty when every probe draws or there is no 2D
 * context. Draws on `canvas`, or on a canvas of the page's own, whose results are remembered.
 */
export function unsupportedVersions(
  probes: readonly EmojiProbe[],
  canvas?: ProbeCanvas,
): Set<number> {
  const unsupported = new Set<number>()
  const context = (canvas ?? defaultCanvas())?.getContext('2d', { willReadFrequently: true })
  if (context === null || context === undefined) return unsupported
  const remembered = canvas === undefined ? pageResults : new Map<string, boolean>()
  const font = fontStack()
  let failed = false
  for (const probe of [...probes].sort((a, b) => a.version - b.version)) {
    if (!failed) {
      const key = `${String(probe.version)} ${probe.emoji}`
      let draws = remembered.get(key)
      if (draws === undefined) {
        draws = drawsProbe(context, probe, font)
        remembered.set(key, draws)
      }
      failed = !draws
    }
    if (failed) unsupported.add(probe.version)
  }
  return unsupported
}
