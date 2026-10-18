import { describe, expect, it } from 'vitest'

import tokensCss from '../theme/tokens.css?raw'
import type { EmojiProbe } from './data'
import {
  drawsProbe,
  EMOJI_FONT_STACK,
  unsupportedVersions,
  type ProbeCanvas,
  type ProbeContext,
} from './support'

const PROBES: EmojiProbe[] = [
  { version: 11, emoji: '🥰' },
  { version: 12, emoji: '🥱' },
  { version: 12.1, emoji: '🧑‍🦰', base: '🧑' },
  { version: 13, emoji: '🥲' },
  { version: 15, emoji: '🫨' },
  { version: 15.1, emoji: '🙂‍↔️', base: '🙂' },
  { version: 16, emoji: '🫩' },
]

/** How the fake canvas draws an emoji it has no color glyph for. */
type Missing = 'box' | 'nothing'

interface Fake {
  readonly context: ProbeContext
  readonly canvas: ProbeCanvas
  /** What was drawn or measured, in order. */
  readonly calls: string[]
}

/**
 * A canvas whose emoji font draws `color` emoji in color, any other as `missing`, and measures
 * text by `widths` (100 by default).
 */
function fakeCanvas(
  color: readonly string[],
  { missing = 'box', widths = {} }: { missing?: Missing; widths?: Record<string, number> } = {},
): Fake {
  const calls: string[] = []
  let last = ''
  const context: ProbeContext = {
    font: '',
    textBaseline: 'alphabetic',
    fillStyle: '#fff',
    setTransform: () => undefined,
    scale: (x, y) => calls.push(`scale ${String(x)} ${String(y)}`),
    clearRect: () => undefined,
    fillText: (text) => {
      last = text
      calls.push(`fill ${text}`)
    },
    getImageData: () => ({
      data: color.includes(last)
        ? [240, 120, 30, 255]
        : missing === 'box'
          ? [0, 0, 0, 255]
          : [0, 0, 0, 0],
    }),
    measureText: (text) => {
      calls.push(`measure ${text}`)
      return { width: widths[text] ?? 100 }
    },
  }
  return { context, canvas: { getContext: () => context }, calls }
}

const ALL = PROBES.map(({ emoji }) => emoji)

describe('unsupportedVersions', () => {
  it('is empty when every probe draws in color', () => {
    expect(unsupportedVersions(PROBES, fakeCanvas(ALL).canvas)).toEqual(new Set())
  })

  it('drops the first version whose probe is a box, and every later one', () => {
    const fake = fakeCanvas(ALL.filter((emoji) => emoji !== '🥲'))
    expect(unsupportedVersions(PROBES, fake.canvas)).toEqual(new Set([13, 15, 15.1, 16]))
    // Nothing after the failure is drawn: versions only add emoji.
    expect(fake.calls).not.toContain('fill 🫨')
  })

  it('counts an emoji that draws nothing as missing', () => {
    const fake = fakeCanvas(['🥰'], { missing: 'nothing' })
    expect(unsupportedVersions(PROBES, fake.canvas)).toEqual(new Set([12, 12.1, 13, 15, 15.1, 16]))
  })

  it('counts a ZWJ sequence drawn as its parts (wider) as missing', () => {
    const wide = fakeCanvas(ALL, { widths: { '🙂‍↔️': 190, '🙂': 100 } })
    expect(unsupportedVersions(PROBES, wide.canvas)).toEqual(new Set([15.1, 16]))
    expect(wide.calls).toContain('measure 🙂')
    const joined = fakeCanvas(ALL, { widths: { '🙂‍↔️': 110, '🙂': 100 } })
    expect(unsupportedVersions(PROBES, joined.canvas)).toEqual(new Set())
  })

  it('goes by version, whatever order the probes come in', () => {
    const fake = fakeCanvas(ALL.filter((emoji) => emoji !== '🥱'))
    expect(unsupportedVersions([...PROBES].reverse(), fake.canvas)).toEqual(
      new Set([12, 12.1, 13, 15, 15.1, 16]),
    )
  })

  it('leaves everything in without a 2D context (jsdom), or on a page without a document', () => {
    expect(unsupportedVersions(PROBES, { getContext: () => null })).toEqual(new Set())
    expect(unsupportedVersions(PROBES)).toEqual(new Set())
  })
})

describe('drawsProbe', () => {
  it('draws a single emoji at 100px in the font, black, from the top, scaled into one pixel', () => {
    const fake = fakeCanvas(['🥰'])
    expect(drawsProbe(fake.context, { version: 11, emoji: '🥰' }, EMOJI_FONT_STACK)).toBe(true)
    expect(fake.context.font).toBe(`100px ${EMOJI_FONT_STACK}`)
    expect(fake.context.textBaseline).toBe('top')
    expect(fake.context.fillStyle).toBe('#000')
    expect(fake.calls).toEqual(['scale 0.01 0.01', 'fill 🥰'])
  })

  it('counts a canvas that throws as drawing (unknown stays in)', () => {
    const fake = fakeCanvas([])
    const throwing: ProbeContext = {
      ...fake.context,
      getImageData: () => {
        throw new Error('tainted')
      },
    }
    expect(drawsProbe(throwing, { version: 11, emoji: '🥰' }, EMOJI_FONT_STACK)).toBe(true)
  })
})

describe('EMOJI_FONT_STACK', () => {
  it('is the stack tokens.css gives --font-emoji', () => {
    const declared = /--font-emoji:\s*([^;]+);/.exec(tokensCss)?.[1]
    expect(declared?.replace(/\s+/g, ' ').trim()).toBe(EMOJI_FONT_STACK)
  })
})
