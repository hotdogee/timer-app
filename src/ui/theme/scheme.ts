/**
 * Material 3 color schemes from one seed color (tech-stack.md › Color). Light and dark schemes use
 * the Tonal Spot variant at standard contrast, the default Material You look.
 *
 * Every standard role becomes a CSS custom property `--md-sys-color-<role>` (kebab-case), and the
 * card design's own surfaces become `--app-background`, `--card-surface` and `--card-tonal` (see
 * {@link APP_TOKENS}); {@link applyTheme} injects them as `<style id="theme">`. The theme follows
 * `prefers-color-scheme`, and `data-theme="light" | "dark"` on `<html>` overrides it.
 */
import {
  argbFromHex,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeTonalSpot,
  type DynamicColor,
  type DynamicScheme,
} from '@material/material-color-utilities'

import { DEFAULT_SEED, parseSeed } from './seed'
import { writeThemeStyle, type ThemeDocument } from './style'

export type ThemeMode = 'light' | 'dark'

/** Standard contrast. -1 is reduced, 0.5 medium and 1 high contrast. */
const CONTRAST_LEVEL = 0

const colors = new MaterialDynamicColors()

/** Every standard M3 color role, by its CSS name, with the dynamic color that produces it. */
const ROLES = {
  primary: colors.primary(),
  'on-primary': colors.onPrimary(),
  'primary-container': colors.primaryContainer(),
  'on-primary-container': colors.onPrimaryContainer(),
  'inverse-primary': colors.inversePrimary(),
  'primary-fixed': colors.primaryFixed(),
  'primary-fixed-dim': colors.primaryFixedDim(),
  'on-primary-fixed': colors.onPrimaryFixed(),
  'on-primary-fixed-variant': colors.onPrimaryFixedVariant(),
  secondary: colors.secondary(),
  'on-secondary': colors.onSecondary(),
  'secondary-container': colors.secondaryContainer(),
  'on-secondary-container': colors.onSecondaryContainer(),
  'secondary-fixed': colors.secondaryFixed(),
  'secondary-fixed-dim': colors.secondaryFixedDim(),
  'on-secondary-fixed': colors.onSecondaryFixed(),
  'on-secondary-fixed-variant': colors.onSecondaryFixedVariant(),
  tertiary: colors.tertiary(),
  'on-tertiary': colors.onTertiary(),
  'tertiary-container': colors.tertiaryContainer(),
  'on-tertiary-container': colors.onTertiaryContainer(),
  'tertiary-fixed': colors.tertiaryFixed(),
  'tertiary-fixed-dim': colors.tertiaryFixedDim(),
  'on-tertiary-fixed': colors.onTertiaryFixed(),
  'on-tertiary-fixed-variant': colors.onTertiaryFixedVariant(),
  error: colors.error(),
  'on-error': colors.onError(),
  'error-container': colors.errorContainer(),
  'on-error-container': colors.onErrorContainer(),
  background: colors.background(),
  'on-background': colors.onBackground(),
  surface: colors.surface(),
  'on-surface': colors.onSurface(),
  'surface-variant': colors.surfaceVariant(),
  'on-surface-variant': colors.onSurfaceVariant(),
  'surface-dim': colors.surfaceDim(),
  'surface-bright': colors.surfaceBright(),
  'surface-container-lowest': colors.surfaceContainerLowest(),
  'surface-container-low': colors.surfaceContainerLow(),
  'surface-container': colors.surfaceContainer(),
  'surface-container-high': colors.surfaceContainerHigh(),
  'surface-container-highest': colors.surfaceContainerHighest(),
  'inverse-surface': colors.inverseSurface(),
  'inverse-on-surface': colors.inverseOnSurface(),
  outline: colors.outline(),
  'outline-variant': colors.outlineVariant(),
  shadow: colors.shadow(),
  scrim: colors.scrim(),
  'surface-tint': colors.surfaceTint(),
} as const satisfies Record<string, DynamicColor>

/** A Material 3 color role, as named in CSS (`on-primary`, `surface-container-high`, …). */
export type ColorRole = keyof typeof ROLES

/** Every color role, in a stable order. */
export const COLOR_ROLES = Object.keys(ROLES) as readonly ColorRole[]

/** A complete scheme: every role mapped to a lowercase `#rrggbb` color. */
export type ColorScheme = Readonly<Record<ColorRole, string>>

/**
 * The card design's own surfaces, as CSS custom properties of the same names (`--card-surface`):
 * the page behind the cards, the card, and the tonal pills on it (chips, Pause and Reset, the
 * ring's track, the end-time chip). The M3 surface roles are near-neutral; the reference card is a
 * blue-slate surface, which the secondary palette matches, so these come from palette tones.
 */
export const APP_TOKENS = ['app-background', 'card-surface', 'card-tonal'] as const

export type AppToken = (typeof APP_TOKENS)[number]

/** The app surfaces for one mode, each a lowercase `#rrggbb` color. */
export type AppColors = Readonly<Record<AppToken, string>>

type PaletteName = 'neutral' | 'neutralVariant' | 'secondary'

/**
 * Palette and tone of each app surface. Dark matches the reference card (Design decisions › Card):
 * page neutral-variant 14, card secondary 20, tonal pills secondary 27, each about 1.2:1 from the
 * next. Light mirrors it: a neutral-variant 94 page, white cards and secondary 90 pills (the light
 * secondary container), about 1.3:1 from the card.
 */
const APP_TONES: Readonly<Record<ThemeMode, Readonly<Record<AppToken, [PaletteName, number]>>>> = {
  dark: {
    'app-background': ['neutralVariant', 14],
    'card-surface': ['secondary', 20],
    'card-tonal': ['secondary', 27],
  },
  light: {
    'app-background': ['neutralVariant', 94],
    'card-surface': ['neutral', 100],
    'card-tonal': ['secondary', 90],
  },
}

function dynamicScheme(seedHex: string, mode: ThemeMode): DynamicScheme {
  const seed = parseSeed(seedHex) ?? DEFAULT_SEED
  return new SchemeTonalSpot(Hct.fromInt(argbFromHex(seed)), mode === 'dark', CONTRAST_LEVEL)
}

function rolesOf(scheme: DynamicScheme): ColorScheme {
  const result = {} as Record<ColorRole, string>
  for (const role of COLOR_ROLES) {
    result[role] = hexFromArgb(ROLES[role].getArgb(scheme))
  }
  return result
}

function appColorsOf(scheme: DynamicScheme, mode: ThemeMode): AppColors {
  const palettes = {
    neutral: scheme.neutralPalette,
    neutralVariant: scheme.neutralVariantPalette,
    secondary: scheme.secondaryPalette,
  }
  const result = {} as Record<AppToken, string>
  for (const token of APP_TOKENS) {
    const [palette, tone] = APP_TONES[mode][token]
    result[token] = hexFromArgb(palettes[palette].tone(tone))
  }
  return result
}

/**
 * Builds the light or dark scheme for a seed color. An invalid seed falls back to
 * {@link DEFAULT_SEED}, so the app always gets a complete theme.
 */
export function buildScheme(seedHex: string, mode: ThemeMode): ColorScheme {
  return rolesOf(dynamicScheme(seedHex, mode))
}

/** The app surfaces ({@link APP_TOKENS}) for a seed color; an invalid seed uses the default. */
export function buildAppColors(seedHex: string, mode: ThemeMode): AppColors {
  return appColorsOf(dynamicScheme(seedHex, mode), mode)
}

/** Every color of one mode: the M3 roles and the app surfaces. */
interface ModeColors {
  readonly roles: ColorScheme
  readonly app: AppColors
}

function modeColors(seedHex: string, mode: ThemeMode): ModeColors {
  const scheme = dynamicScheme(seedHex, mode)
  return { roles: rolesOf(scheme), app: appColorsOf(scheme, mode) }
}

/** One CSS rule block: `color-scheme`, every role and every app surface as custom properties. */
function block(selector: string, mode: ThemeMode, colors: ModeColors, indent = ''): string {
  const lines = [`${indent}${selector} {`, `${indent}  color-scheme: ${mode};`]
  for (const role of COLOR_ROLES) {
    lines.push(`${indent}  --md-sys-color-${role}: ${colors.roles[role]};`)
  }
  for (const token of APP_TOKENS) {
    lines.push(`${indent}  --${token}: ${colors.app[token]};`)
  }
  lines.push(`${indent}}`)
  return lines.join('\n')
}

/**
 * The theme stylesheet for a seed: light on `:root`, dark on `:root[data-theme="dark"]`, and dark
 * when the OS prefers it unless `data-theme="light"` says otherwise.
 */
export function themeCss(seedHex: string): string {
  return schemesCss(modeColors(seedHex, 'light'), modeColors(seedHex, 'dark'))
}

function schemesCss(light: ModeColors, dark: ModeColors): string {
  return [
    block(':root', 'light', light),
    block(':root[data-theme="dark"]', 'dark', dark),
    '@media (prefers-color-scheme: dark) {',
    block(':root:not([data-theme="light"])', 'dark', dark, '  '),
    '}',
    '',
  ].join('\n')
}

/**
 * Writes the theme for `seedHex` into `<style id="theme">` in `<head>` (see `writeThemeStyle`), and
 * points the `theme-color` meta tags (the browser UI tint) at the light and dark page colors.
 */
export function applyTheme(seedHex: string, doc: ThemeDocument = document): void {
  const light = modeColors(seedHex, 'light')
  const dark = modeColors(seedHex, 'dark')
  writeThemeStyle(schemesCss(light, dark), doc)
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = (meta.media.includes('dark') ? dark : light).app['app-background']
  }
}
