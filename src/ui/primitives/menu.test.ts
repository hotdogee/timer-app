import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { nextEnabledIndex, placeMenu, type MenuItem, type PlacementOptions } from './menu'

function items(...disabled: boolean[]): MenuItem[] {
  return disabled.map((off, i) => ({ id: String(i), label: `Item ${i}`, disabled: off }))
}

describe('nextEnabledIndex', () => {
  it('finds the first and last enabled items from the ends', () => {
    const list = items(true, false, false, true)
    expect(nextEnabledIndex(list, -1, 1)).toBe(1)
    expect(nextEnabledIndex(list, list.length, -1)).toBe(2)
  })

  it('steps forward and backward, skipping disabled items', () => {
    const list = items(false, true, false, false)
    expect(nextEnabledIndex(list, 0, 1)).toBe(2)
    expect(nextEnabledIndex(list, 2, -1)).toBe(0)
  })

  it('wraps around at both ends', () => {
    const list = items(false, false, false)
    expect(nextEnabledIndex(list, 2, 1)).toBe(0)
    expect(nextEnabledIndex(list, 0, -1)).toBe(2)
  })

  it('stays on the only enabled item', () => {
    const list = items(true, false, true)
    expect(nextEnabledIndex(list, 1, 1)).toBe(1)
    expect(nextEnabledIndex(list, 1, -1)).toBe(1)
  })

  it('returns -1 when nothing is enabled or the menu is empty', () => {
    expect(nextEnabledIndex(items(true, true), -1, 1)).toBe(-1)
    expect(nextEnabledIndex([], -1, 1)).toBe(-1)
    expect(nextEnabledIndex([], 0, -1)).toBe(-1)
  })

  it('always lands on an enabled item when one exists', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: -1, max: 12 }),
        fc.constantFrom(1 as const, -1 as const),
        (flags, from, step) => {
          const list = items(...flags)
          const index = nextEnabledIndex(list, from, step)
          if (flags.every(Boolean)) expect(index).toBe(-1)
          else expect(list[index]?.disabled).toBe(false)
        },
      ),
    )
  })
})

describe('placeMenu', () => {
  const viewport = { width: 1000, height: 800 }
  const menu = { width: 200, height: 240 }
  // A bottom-right action bar button, like the + Timer trigger.
  const bottomRight = { top: 720, bottom: 764, left: 820, right: 960 }
  const options: PlacementOptions = { placement: 'above', align: 'end', rtl: false }

  it('opens above the anchor, end-aligned, with the gap', () => {
    expect(placeMenu(bottomRight, menu, viewport, options)).toEqual({
      top: 720 - 4 - 240,
      left: 960 - 200,
      placement: 'above',
    })
  })

  it('opens below when asked and there is room', () => {
    const anchor = { top: 100, bottom: 140, left: 100, right: 240 }
    expect(placeMenu(anchor, menu, viewport, { ...options, placement: 'below' })).toMatchObject({
      top: 144,
      placement: 'below',
    })
  })

  it('flips below when there is no room above', () => {
    const anchor = { top: 50, bottom: 90, left: 100, right: 240 }
    expect(placeMenu(anchor, menu, viewport, options)).toMatchObject({
      top: 94,
      placement: 'below',
    })
  })

  it('flips above when there is no room below', () => {
    expect(
      placeMenu(bottomRight, menu, viewport, { ...options, placement: 'below' }),
    ).toMatchObject({ placement: 'above', top: 476 })
  })

  it('takes the roomier side and pins inside the viewport when neither side fits', () => {
    const tall = { width: 200, height: 700 }
    const anchor = { top: 300, bottom: 340, left: 100, right: 240 }
    const position = placeMenu(anchor, tall, viewport, options)
    expect(position.placement).toBe('below')
    expect(position.top).toBe(viewport.height - 8 - tall.height)
  })

  it('pins to the top margin when the menu is taller than the viewport', () => {
    const huge = { width: 200, height: 2000 }
    expect(placeMenu(bottomRight, huge, viewport, options).top).toBe(8)
  })

  it('aligns the start edge: left in LTR, right in RTL', () => {
    const anchor = { top: 400, bottom: 440, left: 300, right: 400 }
    expect(placeMenu(anchor, menu, viewport, { ...options, align: 'start' }).left).toBe(300)
    expect(placeMenu(anchor, menu, viewport, { ...options, align: 'start', rtl: true }).left).toBe(
      400 - 200,
    )
    expect(placeMenu(anchor, menu, viewport, { ...options, align: 'end', rtl: true }).left).toBe(
      300,
    )
  })

  it('shifts horizontally to stay inside the viewport', () => {
    const nearLeft = { top: 400, bottom: 440, left: 0, right: 60 }
    expect(placeMenu(nearLeft, menu, viewport, options).left).toBe(8)
    const nearRight = { top: 400, bottom: 440, left: 950, right: 1000 }
    expect(placeMenu(nearRight, menu, viewport, { ...options, align: 'start' }).left).toBe(
      1000 - 8 - 200,
    )
  })

  it('honors custom gap and margin', () => {
    const position = placeMenu(bottomRight, menu, viewport, { ...options, gap: 10, margin: 0 })
    expect(position.top).toBe(720 - 10 - 240)
  })

  it('always stays inside the viewport when the menu fits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 760 }),
        fc.integer({ min: 0, max: 900 }),
        fc.integer({ min: 40, max: 400 }),
        fc.integer({ min: 80, max: 400 }),
        fc.constantFrom('above' as const, 'below' as const),
        fc.constantFrom('start' as const, 'end' as const),
        fc.boolean(),
        (top, left, height, width, placement, align, rtl) => {
          const anchor = { top, bottom: top + 40, left, right: left + 100 }
          const size = { width, height }
          const position = placeMenu(anchor, size, viewport, { placement, align, rtl })
          expect(position.top).toBeGreaterThanOrEqual(8)
          expect(position.top + height).toBeLessThanOrEqual(viewport.height - 8)
          expect(position.left).toBeGreaterThanOrEqual(8)
          expect(position.left + width).toBeLessThanOrEqual(viewport.width - 8)
        },
      ),
    )
  })
})
