import { afterEach, describe, expect, it, vi } from 'vitest'

import { settings } from '../../core'
import {
  FONT_STACKS,
  applyAppearance,
  applyDefaultSeed,
  followAccent,
  pageColors,
  themeSeed,
  type SchemeModule,
} from './apply'
import { defaultSeedState } from './default-seed.svelte'
import tokensCss from './tokens.css?raw'
import { DEFAULT_THEME_CSS } from './default-theme'
import { themeCss } from './scheme'
import { THEME_STYLE_ID } from './style'

const DEFAULTS = settings.DEVICE_DEFAULTS
const PURPLE = '#8e24aa'

/** A fresh page with the two theme-color metas index.html has. */
function page(): Document {
  const doc = document.implementation.createHTMLDocument('')
  for (const media of ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']) {
    const meta = doc.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('media', media)
    meta.setAttribute('content', '#000000')
    doc.head.append(meta)
  }
  return doc
}

function device(partial: Partial<settings.DeviceSettings> = {}): settings.DeviceSettings {
  return { ...DEFAULTS, ...partial }
}

function themeText(doc: Document): string | null {
  return doc.getElementById(THEME_STYLE_ID)?.textContent ?? null
}

function metas(doc: Document): string[] {
  return [...doc.querySelectorAll('meta[name="theme-color"]')].map(
    (meta) => meta.getAttribute('content') ?? '',
  )
}

function variable(doc: Document, name: string): string {
  return doc.documentElement.style.getPropertyValue(name)
}

/** A scheme loader that waits for `release()`. */
function slowScheme(): { load: () => Promise<SchemeModule>; release: () => void } {
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { load: () => gate.then(() => ({ themeCss })), release }
}

const DEFAULT_COLORS = pageColors(DEFAULT_THEME_CSS)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('applyAppearance', () => {
  it('forces light or dark with data-theme and lets the OS decide for system', () => {
    const doc = page()
    void applyAppearance(device({ themeMode: 'dark' }), doc)
    expect(doc.documentElement.dataset.theme).toBe('dark')
    void applyAppearance(device({ themeMode: 'light' }), doc)
    expect(doc.documentElement.dataset.theme).toBe('light')
    void applyAppearance(device({ themeMode: 'system' }), doc)
    expect(doc.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('sets data-density', () => {
    const doc = page()
    void applyAppearance(device(), doc)
    expect(doc.documentElement.dataset.density).toBe('comfortable')
    void applyAppearance(device({ density: 'compact' }), doc)
    expect(doc.documentElement.dataset.density).toBe('compact')
  })

  it('sets the font stack of each font, every stack ending in sans-serif', () => {
    const doc = page()
    for (const font of settings.FONT_IDS) {
      void applyAppearance(device({ font }), doc)
      expect(variable(doc, '--font-ui')).toBe(FONT_STACKS[font])
      expect(FONT_STACKS[font].endsWith('sans-serif')).toBe(true)
    }
    expect(FONT_STACKS['roboto-flex']).toBe(
      "'Roboto Flex Variable', var(--font-cjk), system-ui, sans-serif",
    )
    expect(FONT_STACKS.inter).toBe("'Inter Variable', var(--font-cjk), system-ui, sans-serif")
    expect(FONT_STACKS.system).toBe(
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', var(--font-cjk), system-ui, sans-serif",
    )
  })

  it('names the page language’s CJK fonts before system-ui in every stack', () => {
    for (const stack of Object.values(FONT_STACKS)) {
      const cjk = stack.indexOf('var(--font-cjk)')
      expect(cjk).toBeGreaterThan(-1)
      expect(cjk).toBeLessThan(stack.indexOf('system-ui'))
    }
    // tokens.css: the default stack is Roboto Flex's; Japanese and Chinese name their UI fonts.
    expect(tokensCss).toContain(`--font-ui: ${FONT_STACKS['roboto-flex']};`)
    expect(tokensCss).toMatch(/:root:lang\(ja\)\s*\{\s*--font-cjk:\s*'Yu Gothic UI'/)
    expect(tokensCss).toMatch(/:root:lang\(zh-TW\)\s*\{\s*--font-cjk:\s*'Microsoft JhengHei UI'/)
  })

  it('sets the digit weight, digit scale and ring scale variables', () => {
    const doc = page()
    void applyAppearance(device({ fontWeight: 700, digitScale: 1.5, ringScale: 0.5 }), doc)
    expect(variable(doc, '--digit-weight')).toBe('700')
    expect(variable(doc, '--digit-scale')).toBe('1.5')
    expect(variable(doc, '--ring-scale')).toBe('0.5')
    void applyAppearance(device({ digitScale: 0.75, ringScale: 2 }), doc)
    expect(variable(doc, '--digit-weight')).toBe('400')
    expect(variable(doc, '--digit-scale')).toBe('0.75')
    expect(variable(doc, '--ring-scale')).toBe('2')
  })

  it('falls back to the defaults for numbers that are not finite', () => {
    const doc = page()
    void applyAppearance(
      device({ fontWeight: Number.NaN, digitScale: Infinity, ringScale: -Infinity }),
      doc,
    )
    expect(variable(doc, '--digit-weight')).toBe('400')
    expect(variable(doc, '--digit-scale')).toBe('1')
    expect(variable(doc, '--ring-scale')).toBe('1')
  })

  it('writes the precomputed default theme at once for the default seed', async () => {
    for (const seed of ['', '#0B57D0', '0b57d0', 'not a color']) {
      const doc = page()
      const done = applyAppearance(device({ seed }), doc)
      expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
      expect(metas(doc)).toEqual([DEFAULT_COLORS?.light, DEFAULT_COLORS?.dark])
      await expect(done).resolves.toBeUndefined()
    }
  })

  it('generates the theme for another seed once the color library loads', async () => {
    const doc = page()
    const done = applyAppearance(device({ seed: PURPLE }), doc)
    expect(themeText(doc)).toBeNull()
    await done
    const css = themeCss(PURPLE)
    expect(themeText(doc)).toBe(css)
    const colors = pageColors(css)
    expect(metas(doc)).toEqual([colors?.light, colors?.dark])
    expect(colors?.light).not.toBe(DEFAULT_COLORS?.light)
  })

  it('points both theme-color metas at the forced mode’s page color', async () => {
    const doc = page()
    void applyAppearance(device({ themeMode: 'dark' }), doc)
    expect(metas(doc)).toEqual([DEFAULT_COLORS?.dark, DEFAULT_COLORS?.dark])
    void applyAppearance(device({ themeMode: 'light' }), doc)
    expect(metas(doc)).toEqual([DEFAULT_COLORS?.light, DEFAULT_COLORS?.light])
    await applyAppearance(device({ themeMode: 'dark', seed: PURPLE }), doc)
    const colors = pageColors(themeCss(PURPLE))
    expect(metas(doc)).toEqual([colors?.dark, colors?.dark])
  })

  it('writes nothing when nothing changed', async () => {
    const doc = page()
    const settingsNow = device({ themeMode: 'dark', density: 'compact', seed: PURPLE })
    await applyAppearance(settingsNow, doc)
    const style = doc.getElementById(THEME_STYLE_ID)
    if (style === null) throw new Error('no theme style')
    style.textContent = 'marker'
    const observer = new MutationObserver(() => undefined)
    observer.observe(doc, { subtree: true, attributes: true, childList: true, characterData: true })
    await applyAppearance({ ...settingsNow }, doc)
    expect(observer.takeRecords()).toEqual([])
    expect(style.textContent).toBe('marker')
    observer.disconnect()
  })

  it('themes again when only the seed changes, and back to the default', async () => {
    const doc = page()
    await applyAppearance(device({ seed: PURPLE }), doc)
    await applyAppearance(device({ seed: '#00897b' }), doc)
    expect(themeText(doc)).toBe(themeCss('#00897b'))
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
    expect(metas(doc)).toEqual([DEFAULT_COLORS?.light, DEFAULT_COLORS?.dark])
  })

  it('drops a theme that finishes loading after a newer one', async () => {
    const doc = page()
    const slow = slowScheme()
    const late = applyAppearance(device({ seed: PURPLE }), doc, { loadScheme: slow.load })
    // Reset to the default before the library arrives: the default stays.
    await applyAppearance(device(), doc, { loadScheme: slow.load })
    slow.release()
    await late
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
  })

  it('shares one load between calls made while it is pending', async () => {
    const doc = page()
    const load = vi.fn(() => Promise.resolve<SchemeModule>({ themeCss }))
    const first = applyAppearance(device({ seed: PURPLE }), doc, { loadScheme: load })
    const second = applyAppearance(device({ seed: PURPLE, density: 'compact' }), doc, {
      loadScheme: load,
    })
    expect(second).toBe(first)
    await second
    expect(load).toHaveBeenCalledTimes(1)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
  })

  it('keeps the default theme when the color library fails to load, and retries later', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const doc = page()
    const failing = (): Promise<SchemeModule> => Promise.reject(new Error('offline'))
    await expect(
      applyAppearance(device({ seed: PURPLE }), doc, { loadScheme: failing }),
    ).resolves.toBeUndefined()
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
    expect(warn).toHaveBeenCalledTimes(1)
    await applyAppearance(device({ seed: PURPLE }), doc)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
  })

  it('themes with defaultSeed (the accent) when the setting is the default', async () => {
    const doc = page()
    await applyAppearance(device(), doc, { defaultSeed: PURPLE })
    expect(themeText(doc)).toBe(themeCss(PURPLE))
    await applyAppearance(device({ seed: '#00897b' }), doc, { defaultSeed: PURPLE })
    expect(themeText(doc)).toBe(themeCss('#00897b'))
  })

  it('uses the document by default', () => {
    void applyAppearance(device({ density: 'compact' }))
    expect(document.documentElement.dataset.density).toBe('compact')
    void applyAppearance(device())
    expect(document.documentElement.dataset.density).toBe('comfortable')
  })
})

describe('applyDefaultSeed', () => {
  const TEAL = '#00897b'

  it('re-themes a page that follows the accent, and keeps the accent for later calls', async () => {
    const doc = page()
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
    await applyDefaultSeed(PURPLE, doc)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
    // The app's effect applies the settings again without a defaultSeed: the accent stays.
    await applyAppearance(device({ density: 'compact' }), doc)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
    await applyDefaultSeed(null, doc)
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
  })

  it('leaves a page with a seed of its own alone until it follows the accent again', async () => {
    const doc = page()
    await applyAppearance(device({ seed: TEAL }), doc)
    await applyDefaultSeed(PURPLE, doc)
    expect(themeText(doc)).toBe(themeCss(TEAL))
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
  })

  it('only remembers the accent before the page is first themed', async () => {
    const doc = page()
    await applyDefaultSeed(PURPLE, doc)
    expect(themeText(doc)).toBeNull()
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
  })

  it('lets an explicit defaultSeed replace the remembered accent', async () => {
    const doc = page()
    await applyDefaultSeed(PURPLE, doc)
    await applyAppearance(device(), doc, { defaultSeed: null })
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
  })

  it('tells Settings which accent the page itself uses, not another document', async () => {
    await applyDefaultSeed('#8E24AA')
    expect(defaultSeedState.current).toBe(PURPLE)
    // Another document (the Picture-in-Picture window, a test page) is not the app's.
    await applyDefaultSeed(TEAL, page())
    expect(defaultSeedState.current).toBe(PURPLE)
    // Google blue is the default anyway: no accent to name.
    await applyDefaultSeed('#0B57D0')
    expect(defaultSeedState.current).toBeNull()
    await applyDefaultSeed(TEAL)
    await applyAppearance(device(), document, { defaultSeed: null })
    expect(defaultSeedState.current).toBeNull()
  })
})

describe('followAccent', () => {
  /** An accent source whose answer and changes the test controls. */
  function accentSource(answer: Promise<string | null>) {
    const listeners = new Set<(accent: string) => void>()
    return {
      get: vi.fn(() => answer),
      onChange(listener: (accent: string) => void) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      change(accent: string) {
        for (const listener of listeners) listener(accent)
      },
      get listening() {
        return listeners.size
      },
    }
  }

  it('themes with the accent that arrives in time, and with every later change', async () => {
    const doc = page()
    const source = accentSource(Promise.resolve('#8E24AA'))
    void applyAppearance(device(), doc)
    const stop = await followAccent(source, 100, doc)
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(themeCss(PURPLE))
    source.change('#00897b')
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(themeCss('#00897b'))
    stop()
    expect(source.listening).toBe(0)
  })

  it('does not hold startup for a slow accent, and themes when it arrives', async () => {
    vi.useFakeTimers()
    try {
      const doc = page()
      let answer: (accent: string | null) => void = () => undefined
      const source = accentSource(
        new Promise((resolve) => {
          answer = resolve
        }),
      )
      const following = followAccent(source, 100, doc)
      await vi.advanceTimersByTimeAsync(100)
      await following
      await applyAppearance(device(), doc)
      expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
      answer(PURPLE)
      await vi.advanceTimersByTimeAsync(0)
      await applyAppearance(device(), doc)
      expect(themeText(doc)).toBe(themeCss(PURPLE))
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a change that came before the first answer', async () => {
    vi.useFakeTimers()
    try {
      const doc = page()
      void applyAppearance(device(), doc)
      let answer: (accent: string | null) => void = () => undefined
      const source = accentSource(
        new Promise((resolve) => {
          answer = resolve
        }),
      )
      void followAccent(source, 100, doc)
      source.change('#00897b')
      answer(PURPLE)
      await vi.advanceTimersByTimeAsync(200)
      await applyAppearance(device(), doc)
      expect(themeText(doc)).toBe(themeCss('#00897b'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('works with a source that has no change events, as on the web', async () => {
    const doc = page()
    void applyAppearance(device(), doc)
    const stop = await followAccent({ get: () => Promise.resolve(null) }, 100, doc)
    await applyAppearance(device(), doc)
    expect(themeText(doc)).toBe(DEFAULT_THEME_CSS)
    expect(stop).toBeTypeOf('function')
    stop()
  })
})

describe('themeSeed', () => {
  it('normalizes the setting, then the default seed, then Google blue', () => {
    expect(themeSeed('#8E24AA')).toBe(PURPLE)
    expect(themeSeed('', '#ABC')).toBe('#aabbcc')
    expect(themeSeed('nope', 'also nope')).toBe('#0b57d0')
    expect(themeSeed('', null)).toBe('#0b57d0')
  })
})

describe('pageColors', () => {
  it('reads the light and dark page colors of a theme', () => {
    expect(pageColors(themeCss('#0B57D0'))).toEqual(pageColors(DEFAULT_THEME_CSS))
    expect(DEFAULT_COLORS).toEqual({ light: '#ededf7', dark: '#21232b' })
  })

  it('is null for text without both colors', () => {
    expect(pageColors('')).toBeNull()
    expect(pageColors(':root { --app-background: #ffffff; }')).toBeNull()
  })
})
