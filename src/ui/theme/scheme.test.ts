import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import indexHtml from '../../../index.html?raw'
import { contrastRatio } from './contrast'
import { DEFAULT_THEME_CSS } from './default-theme'
import {
  APP_TOKENS,
  applyTheme,
  buildAppColors,
  buildScheme,
  COLOR_ROLES,
  themeCss,
  type AppColors,
  type AppToken,
  type ColorRole,
  type ColorScheme,
  type ThemeMode,
} from './scheme'
import { DEFAULT_SEED, parseSeed } from './seed'
import { THEME_STYLE_ID, type ThemeDocument } from './style'

const HEX6 = /^#[0-9a-f]{6}$/
const MODES: readonly ThemeMode[] = ['light', 'dark']

/** Seeds across the hue wheel plus the achromatic extremes. */
const SAMPLE_SEEDS = [
  DEFAULT_SEED,
  '#d32f2f',
  '#2e7d32',
  '#fbc02d',
  '#6a1b9a',
  '#808080',
  '#000000',
]

const seedArb = fc
  .integer({ min: 0, max: 0xffffff })
  .map((n) => `#${n.toString(16).padStart(6, '0')}`)

/** The background each `on-*` role is drawn on. */
function pairOf(role: ColorRole): ColorRole | undefined {
  if (role === 'inverse-on-surface') return 'inverse-surface'
  if (!role.startsWith('on-')) return undefined
  const base = role.slice(3)
  if ((COLOR_ROLES as readonly string[]).includes(base)) return base as ColorRole
  // on-primary-fixed-variant is drawn on primary-fixed.
  const withoutVariant = base.replace(/-variant$/, '')
  return (COLOR_ROLES as readonly string[]).includes(withoutVariant)
    ? (withoutVariant as ColorRole)
    : undefined
}

const ON_PAIRS = COLOR_ROLES.flatMap((role) => {
  const background = pairOf(role)
  return background ? [[role, background] as const] : []
})

/** Pairs the card design relies on besides the `on-*` pairs (Design decisions › Card). */
const DESIGN_PAIRS: readonly (readonly [ColorRole, AppToken, number])[] = [
  ['on-surface', 'card-surface', 4.5], // digits and the card name
  ['on-surface', 'card-tonal', 4.5], // icons on tonal buttons, chip labels
  ['on-surface-variant', 'card-surface', 4.5], // secondary text on the card
  ['on-surface-variant', 'card-tonal', 4.5], // the end-time chip
  ['primary', 'card-surface', 4.5], // typed digits, "Time's up"
  ['primary', 'card-tonal', 3], // the ring's arc on its track
  ['primary', 'app-background', 3], // focus ring and selection outline
  ['on-surface', 'app-background', 4.5], // the empty state's text
]

function lowContrastPairs(scheme: ColorScheme, app: AppColors): string[] {
  const failures: string[] = []
  for (const [fg, bg] of ON_PAIRS) {
    const ratio = contrastRatio(scheme[fg], scheme[bg])
    if (!(ratio >= 3)) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`)
  }
  for (const [fg, bg, min] of DESIGN_PAIRS) {
    const ratio = contrastRatio(scheme[fg], app[bg])
    if (!(ratio >= min)) failures.push(`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`)
  }
  return failures
}

function lowContrast(seed: string, mode: ThemeMode): string[] {
  return lowContrastPairs(buildScheme(seed, mode), buildAppColors(seed, mode))
}

describe('parseSeed', () => {
  it('normalizes #rrggbb to lowercase', () => {
    expect(parseSeed('#0B57D0')).toBe('#0b57d0')
  })

  it('accepts a missing # and surrounding whitespace', () => {
    expect(parseSeed('  0b57d0 ')).toBe('#0b57d0')
  })

  it('expands #rgb', () => {
    expect(parseSeed('#AbC')).toBe('#aabbcc')
    expect(parseSeed('fff')).toBe('#ffffff')
  })

  it('rejects anything else', () => {
    for (const bad of ['', '#', '#12', '#1234', '#12345', '#1234567', '#gggggg', 'blue', '##fff']) {
      expect(parseSeed(bad)).toBeNull()
    }
  })
})

describe('buildScheme', () => {
  it('has exactly the standard roles, each a #rrggbb color', () => {
    for (const mode of MODES) {
      const scheme = buildScheme(DEFAULT_SEED, mode)
      expect(Object.keys(scheme).sort()).toEqual([...COLOR_ROLES].sort())
      for (const role of COLOR_ROLES) expect(scheme[role]).toMatch(HEX6)
    }
  })

  it('includes every surface-container tier and the roles the card uses', () => {
    const required: readonly string[] = [
      'primary',
      'on-primary',
      'surface',
      'on-surface',
      'on-surface-variant',
      'surface-container-lowest',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
      'surface-container-highest',
      'outline',
      'outline-variant',
      'inverse-surface',
      'inverse-on-surface',
      'inverse-primary',
      'scrim',
      'shadow',
    ]
    for (const role of required) expect(COLOR_ROLES).toContain(role)
  })

  it('pairs every on-* role with a background role', () => {
    const onRoles = COLOR_ROLES.filter((role) => role.startsWith('on-') || role.includes('-on-'))
    expect(ON_PAIRS.map(([fg]) => fg).sort()).toEqual([...onRoles].sort())
  })

  it('gives light and dark schemes different colors', () => {
    const light = buildScheme(DEFAULT_SEED, 'light')
    const dark = buildScheme(DEFAULT_SEED, 'dark')
    expect(light.surface).not.toBe(dark.surface)
    expect(light.primary).not.toBe(dark.primary)
    expect(light['on-surface']).not.toBe(dark['on-surface'])
  })

  it('makes dark surfaces dark and light surfaces light', () => {
    const lum = (hex: string) => contrastRatio(hex, '#000000')
    expect(lum(buildScheme(DEFAULT_SEED, 'dark').surface)).toBeLessThan(1.5)
    expect(lum(buildScheme(DEFAULT_SEED, 'light').surface)).toBeGreaterThan(15)
  })

  it('keeps on-* roles and the card pairs readable for sample seeds', () => {
    for (const seed of SAMPLE_SEEDS) {
      for (const mode of MODES) {
        expect(lowContrast(seed, mode), `${seed} ${mode}`).toEqual([])
      }
    }
  })

  it('keeps on-* roles at 3:1 or better for any seed', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(...MODES), (seed, mode) => {
        expect(lowContrast(seed, mode)).toEqual([])
      }),
      { numRuns: 60 },
    )
  })

  it('falls back to the default seed for an invalid seed', () => {
    for (const mode of MODES) {
      const fallback = buildScheme(DEFAULT_SEED, mode)
      expect(buildScheme('not a color', mode)).toEqual(fallback)
      expect(buildScheme('', mode)).toEqual(fallback)
      expect(buildScheme('#12345', mode)).toEqual(fallback)
    }
  })

  it('treats #rgb, missing # and case the same as the full form', () => {
    expect(buildScheme('#abc', 'dark')).toEqual(buildScheme('#AABBCC', 'dark'))
    expect(buildScheme('0b57d0', 'light')).toEqual(buildScheme(DEFAULT_SEED, 'light'))
  })

  it('changes with the seed', () => {
    expect(buildScheme('#d32f2f', 'dark').primary).not.toBe(
      buildScheme(DEFAULT_SEED, 'dark').primary,
    )
  })
})

describe('buildAppColors', () => {
  it('has every app surface, each a #rrggbb color', () => {
    for (const mode of MODES) {
      const app = buildAppColors(DEFAULT_SEED, mode)
      expect(Object.keys(app).sort()).toEqual([...APP_TOKENS].sort())
      for (const token of APP_TOKENS) expect(app[token]).toMatch(HEX6)
    }
  })

  it('matches the reference card in dark mode: a blue-slate card with lighter tonal pills', () => {
    // The reference (docs/design, Google's card): page #22242a, card #2c303d, chips #3a3f50.
    expect(buildAppColors(DEFAULT_SEED, 'dark')).toEqual({
      'app-background': '#21232b',
      'card-surface': '#2a3042',
      'card-tonal': '#393f52',
    })
  })

  it('puts white cards with secondary-container pills on a light gray page in light mode', () => {
    const app = buildAppColors(DEFAULT_SEED, 'light')
    expect(app['card-surface']).toBe('#ffffff')
    expect(app['card-tonal']).toBe(buildScheme(DEFAULT_SEED, 'light')['secondary-container'])
  })

  it('keeps the page, card and tonal pills apart (about 1.2:1 or more) in both modes', () => {
    for (const seed of SAMPLE_SEEDS) {
      for (const mode of MODES) {
        const app = buildAppColors(seed, mode)
        expect(contrastRatio(app['card-surface'], app['app-background'])).toBeGreaterThan(1.12)
        expect(contrastRatio(app['card-tonal'], app['card-surface'])).toBeGreaterThan(1.2)
      }
    }
  })

  it('uses the default seed for an invalid seed', () => {
    expect(buildAppColors('oops', 'dark')).toEqual(buildAppColors(DEFAULT_SEED, 'dark'))
  })
})

describe('themeCss', () => {
  const css = themeCss(DEFAULT_SEED)
  const light = buildScheme(DEFAULT_SEED, 'light')
  const dark = buildScheme(DEFAULT_SEED, 'dark')
  const lightApp = buildAppColors(DEFAULT_SEED, 'light')
  const darkApp = buildAppColors(DEFAULT_SEED, 'dark')

  /** The declarations inside the first block that opens with `selector {`. */
  function blockBody(selector: string): string {
    const start = css.indexOf(`${selector} {`)
    expect(start, `missing block ${selector}`).toBeGreaterThanOrEqual(0)
    return css.slice(start, css.indexOf('}', start))
  }

  it('has a light :root block, a forced dark block and an OS-dark media block', () => {
    expect(css).toMatch(/^:root \{/)
    expect(css).toContain(':root[data-theme="dark"] {')
    expect(css).toMatch(
      /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/,
    )
  })

  it('declares every role and app surface in each block with the matching scheme', () => {
    const blocks = [
      [blockBody(':root'), light, lightApp],
      [blockBody(':root[data-theme="dark"]'), dark, darkApp],
      [blockBody(':root:not([data-theme="light"])'), dark, darkApp],
    ] as const
    for (const [body, scheme, app] of blocks) {
      for (const role of COLOR_ROLES) {
        expect(body).toContain(`--md-sys-color-${role}: ${scheme[role]};`)
      }
      for (const token of APP_TOKENS) expect(body).toContain(`--${token}: ${app[token]};`)
    }
  })

  it('sets color-scheme in each block', () => {
    expect(blockBody(':root')).toContain('color-scheme: light;')
    expect(blockBody(':root[data-theme="dark"]')).toContain('color-scheme: dark;')
    expect(blockBody(':root:not([data-theme="light"])')).toContain('color-scheme: dark;')
  })

  it('has balanced braces', () => {
    expect(css.split('{').length).toBe(css.split('}').length)
  })

  it('uses the default seed for an invalid seed', () => {
    expect(themeCss('oops')).toBe(css)
  })

  it('matches the precomputed default theme that startup writes', async () => {
    // Regenerate with `pnpm test -u` after changing the scheme.
    await expect(css).toMatchFileSnapshot('./default-theme.css')
    expect(DEFAULT_THEME_CSS).toBe(css)
  })
})

describe('applyTheme', () => {
  interface FakeElement {
    id: string
    textContent: string | null
  }
  interface FakeMeta {
    media: string
    content: string
  }

  function fakeDocument(metas: FakeMeta[] = []) {
    const head: FakeElement[] = []
    const doc = {
      head: {
        append: (element: FakeElement) => {
          head.push(element)
        },
      },
      getElementById: (id: string) => head.find((element) => element.id === id) ?? null,
      createElement: (tag: string) => {
        expect(tag).toBe('style')
        return { id: '', textContent: null } satisfies FakeElement
      },
      querySelectorAll: (selector: string) => {
        expect(selector).toBe('meta[name="theme-color"]')
        return metas
      },
    }
    return { doc: doc as unknown as ThemeDocument, head }
  }

  it('creates <style id="theme"> in <head> with the theme CSS', () => {
    const { doc, head } = fakeDocument()
    applyTheme(DEFAULT_SEED, doc)
    expect(head).toHaveLength(1)
    expect(head[0]?.id).toBe(THEME_STYLE_ID)
    expect(head[0]?.textContent).toBe(themeCss(DEFAULT_SEED))
  })

  it('replaces the existing theme instead of adding another', () => {
    const { doc, head } = fakeDocument()
    applyTheme(DEFAULT_SEED, doc)
    applyTheme('#d32f2f', doc)
    expect(head).toHaveLength(1)
    expect(head[0]?.textContent).toBe(themeCss('#d32f2f'))
  })

  it('points the light and dark theme-color metas at the matching page color', () => {
    const metas: FakeMeta[] = [
      { media: '(prefers-color-scheme: light)', content: '' },
      { media: '(prefers-color-scheme: dark)', content: '' },
    ]
    const { doc } = fakeDocument(metas)
    applyTheme(DEFAULT_SEED, doc)
    expect(metas[0]?.content).toBe(buildAppColors(DEFAULT_SEED, 'light')['app-background'])
    expect(metas[1]?.content).toBe(buildAppColors(DEFAULT_SEED, 'dark')['app-background'])
  })

  it('matches the default page colors in index.html', () => {
    for (const mode of MODES) {
      const color = buildAppColors(DEFAULT_SEED, mode)['app-background']
      expect(indexHtml).toContain(
        `name="theme-color" media="(prefers-color-scheme: ${mode})" content="${color}"`,
      )
    }
  })
})
