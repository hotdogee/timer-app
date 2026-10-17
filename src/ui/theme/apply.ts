/**
 * Puts the appearance settings on the page (spec › Settings › Appearance): theme mode, seed
 * color, font, digit weight and size, ring thickness and card density. Everything lands on
 * `<html>`, where the stylesheets read it:
 *
 * - `data-theme` = `light` | `dark` forces a scheme; it is removed for `system`, so the theme's
 *   `prefers-color-scheme` block decides.
 * - `data-density` = `comfortable` | `compact`; tokens.css tightens the cards and the grid for
 *   `compact`.
 * - `--font-ui` (the whole UI, digits included), `--digit-weight`, `--digit-scale` and
 *   `--ring-scale`, as inline custom properties.
 * - The color theme in `<style id="theme">`: the precomputed default for the default seed (no
 *   color library), otherwise generated from the seed, which loads the library first. The
 *   `theme-color` metas follow the page color of the mode in force.
 *
 * {@link applyAppearance} is idempotent and cheap: it writes only what differs from the page, and
 * themes again only when the seed changes, so the app calls it from an effect on every device
 * settings change. CJK text gets the fonts of the page's language through `--font-cjk`
 * (see {@link FONT_STACKS}), and every stack ends in `sans-serif`.
 */
import type { settings } from '../../core'
import { DEFAULT_THEME_CSS } from './default-theme'
import { DEFAULT_SEED, parseSeed } from './seed'
import { writeThemeStyle, type ThemeDocument } from './style'

/**
 * The `font-family` stack of each font setting. `--font-cjk` (tokens.css) comes before
 * `system-ui`: it names the Chinese or Japanese UI fonts for `<html lang>`, because Chromium on
 * Windows maps `system-ui` to the OS's own UI font, which on a Chinese or Japanese Windows covers
 * every CJK character in that region's forms, so the browser would never reach `sans-serif`, the
 * only family that follows `lang`. Elsewhere `--font-cjk` is `system-ui`.
 */
export const FONT_STACKS: Readonly<Record<settings.FontId, string>> = Object.freeze({
  'roboto-flex': "'Roboto Flex Variable', var(--font-cjk), system-ui, sans-serif",
  inter: "'Inter Variable', var(--font-cjk), system-ui, sans-serif",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', var(--font-cjk), system-ui, sans-serif",
})

/** The parts of `Document` that applying the appearance uses. */
export type AppearanceDocument = ThemeDocument & Pick<Document, 'documentElement'>

/** The scheme generator's entry point that theming needs (`./scheme`, loaded lazily). */
export interface SchemeModule {
  themeCss(seedHex: string): string
}

/** Options for {@link applyAppearance}. */
export interface AppearanceOptions {
  /**
   * The seed when the setting is `''` (the default): the platform accent color once there is one
   * (desktop, M5). Invalid or missing: {@link DEFAULT_SEED}.
   */
  readonly defaultSeed?: string | null | undefined
  /** Loads the scheme generator. Defaults to importing `./scheme`; tests may slow it down. */
  readonly loadScheme?: (() => Promise<SchemeModule>) | undefined
}

/** The page color (`--app-background`) of each mode, for the `theme-color` metas. */
interface PageColors {
  readonly light: string
  readonly dark: string
}

/** What one document shows now, so a repeated call writes nothing. */
interface Applied {
  /** The normalized seed whose theme is on the page or loading; null before the first call. */
  seed: string | null
  /** The theme's page colors, once the theme is on the page. */
  colors: PageColors | null
  mode: settings.ThemeMode
  /** Bumped for each new theme, so a slow one that finishes late is dropped. */
  request: number
  /** Settles when the latest theme is on the page. */
  done: Promise<void>
}

const NORMALIZED_DEFAULT_SEED = parseSeed(DEFAULT_SEED) ?? DEFAULT_SEED

const APP_BACKGROUND = /--app-background:\s*(#[0-9a-f]{6})/gi

/**
 * The light and dark page colors in a theme stylesheet (`themeCss`): its first `--app-background`
 * is the light block's, the second the dark block's. Null when the text has fewer than two.
 */
export function pageColors(css: string): PageColors | null {
  const [light, dark] = [...css.matchAll(APP_BACKGROUND)].map((match) => match[1])
  return light === undefined || dark === undefined ? null : { light, dark }
}

const DEFAULT_COLORS: PageColors = pageColors(DEFAULT_THEME_CSS) ?? {
  light: '#ededf7',
  dark: '#21232b',
}

const loadDefaultScheme = (): Promise<SchemeModule> => import('./scheme')

const appliedByDocument = new WeakMap<object, Applied>()

function appliedTo(doc: AppearanceDocument): Applied {
  let applied = appliedByDocument.get(doc)
  if (applied === undefined) {
    applied = { seed: null, colors: null, mode: 'system', request: 0, done: Promise.resolve() }
    appliedByDocument.set(doc, applied)
  }
  return applied
}

/** The seed to theme with: the setting, else `defaultSeed`, else the default; lowercase. */
export function themeSeed(seed: string, defaultSeed?: string | null): string {
  return (
    parseSeed(seed) ??
    (typeof defaultSeed === 'string' ? parseSeed(defaultSeed) : null) ??
    NORMALIZED_DEFAULT_SEED
  )
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name)
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value)
  }
}

function setVariable(element: HTMLElement, name: string, value: string): void {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
}

/** Points the `theme-color` metas at the page color of the scheme each one shows. */
function writeMetas(doc: AppearanceDocument, colors: PageColors, mode: settings.ThemeMode): void {
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const dark = (meta.getAttribute('media') ?? '').includes('dark')
    const content = colors[mode === 'system' ? (dark ? 'dark' : 'light') : mode]
    if (meta.getAttribute('content') !== content) meta.setAttribute('content', content)
  }
}

/** Puts the theme for `seed` on the page: at once for the default, after loading otherwise. */
function theme(
  doc: AppearanceDocument,
  applied: Applied,
  seed: string,
  load: () => Promise<SchemeModule>,
): void {
  applied.seed = seed
  const request = ++applied.request
  const show = (css: string, colors: PageColors): void => {
    writeThemeStyle(css, doc)
    applied.colors = colors
    writeMetas(doc, colors, applied.mode)
  }
  if (seed === NORMALIZED_DEFAULT_SEED) {
    show(DEFAULT_THEME_CSS, DEFAULT_COLORS)
    applied.done = Promise.resolve()
    return
  }
  applied.done = Promise.resolve()
    .then(load)
    .then(
      (scheme) => {
        if (applied.request !== request) return
        const css = scheme.themeCss(seed)
        show(css, pageColors(css) ?? DEFAULT_COLORS)
      },
      (error: unknown) => {
        if (applied.request !== request) return
        // The generator failed to load (offline before it was cached, say): the default theme
        // still works, and the next call with this seed tries again.
        console.warn('Timer App: could not build the theme; using the default', error)
        show(DEFAULT_THEME_CSS, DEFAULT_COLORS)
        applied.seed = null
      },
    )
}

/**
 * Applies the appearance settings to `doc` (see the module comment). Writes only what changed
 * since the last call, and generates the color theme only when the seed changed. Returns a promise
 * that settles once the color theme is on the page: at once for the default seed; a custom seed
 * waits for the color library (about 20 kB), so startup can await it and paint the right colors
 * from the first frame. It never rejects: a library that fails to load leaves the default theme.
 */
export function applyAppearance(
  device: settings.DeviceSettings,
  doc: AppearanceDocument = document,
  options: AppearanceOptions = {},
): Promise<void> {
  const root = doc.documentElement
  const mode = device.themeMode === 'light' || device.themeMode === 'dark' ? device.themeMode : null
  setAttribute(root, 'data-theme', mode)
  setAttribute(root, 'data-density', device.density === 'compact' ? 'compact' : 'comfortable')
  setVariable(root, '--font-ui', FONT_STACKS[device.font] ?? FONT_STACKS['roboto-flex'])
  setVariable(root, '--digit-weight', String(finite(device.fontWeight, 400)))
  setVariable(root, '--digit-scale', String(finite(device.digitScale, 1)))
  setVariable(root, '--ring-scale', String(finite(device.ringScale, 1)))

  const applied = appliedTo(doc)
  applied.mode = mode ?? 'system'
  const seed = themeSeed(device.seed, options.defaultSeed)
  if (seed !== applied.seed) {
    theme(doc, applied, seed, options.loadScheme ?? loadDefaultScheme)
  } else if (applied.colors !== null) {
    writeMetas(doc, applied.colors, applied.mode)
  }
  return applied.done
}
