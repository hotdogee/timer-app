import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  dragTranslation,
  dropIndex,
  edgeScroll,
  nearestSlot,
  slotAt,
  type Rect,
} from './drag-reorder'

/** Slots of `count` 300×200 cards in `columns` columns with a 16px gap, starting at (16, 16). */
function grid(count: number, columns: number): Rect[] {
  return Array.from({ length: count }, (_, i) => ({
    left: 16 + (i % columns) * 316,
    top: 16 + Math.floor(i / columns) * 216,
    width: 300,
    height: 200,
  }))
}

describe('slotAt', () => {
  const slots = grid(5, 3)

  it('finds the slot under the point', () => {
    expect(slotAt(slots, { x: 20, y: 20 })).toBe(0)
    expect(slotAt(slots, { x: 400, y: 100 })).toBe(1)
    expect(slotAt(slots, { x: 700, y: 50 })).toBe(2)
    expect(slotAt(slots, { x: 100, y: 300 })).toBe(3)
    expect(slotAt(slots, { x: 400, y: 400 })).toBe(4)
  })

  it('treats the right and bottom edges as outside', () => {
    expect(slotAt(slots, { x: 316, y: 100 })).toBe(-1)
    expect(slotAt(slots, { x: 100, y: 216 })).toBe(-1)
  })

  it('returns -1 in gaps, in the empty part of the last row and outside', () => {
    expect(slotAt(slots, { x: 320, y: 100 })).toBe(-1)
    expect(slotAt(slots, { x: 700, y: 300 })).toBe(-1)
    expect(slotAt(slots, { x: -50, y: -50 })).toBe(-1)
    expect(slotAt([], { x: 0, y: 0 })).toBe(-1)
  })
})

describe('nearestSlot', () => {
  const slots = grid(5, 3)

  it('is the containing slot when there is one', () => {
    expect(nearestSlot(slots, { x: 400, y: 100 })).toBe(1)
  })

  it('picks the closer neighbor in a gap', () => {
    expect(nearestSlot(slots, { x: 318, y: 100 })).toBe(0)
    expect(nearestSlot(slots, { x: 329, y: 100 })).toBe(1)
  })

  it('picks the last card from the empty part of the last row', () => {
    expect(nearestSlot(slots, { x: 900, y: 300 })).toBe(4)
  })

  it('picks the first card from above and left of the grid', () => {
    expect(nearestSlot(slots, { x: -100, y: -100 })).toBe(0)
  })

  it('returns -1 without slots or for a non-finite point', () => {
    expect(nearestSlot([], { x: 0, y: 0 })).toBe(-1)
    expect(nearestSlot(slots, { x: Number.NaN, y: 0 })).toBe(-1)
    expect(nearestSlot(slots, { x: 0, y: Number.POSITIVE_INFINITY })).toBe(-1)
  })
})

describe('dropIndex', () => {
  const slots = grid(4, 2)

  it('moves to the slot under the pointer', () => {
    expect(dropIndex(slots, { x: 400, y: 300 }, 0)).toBe(3)
  })

  it('moves to the end when dragged past the last card', () => {
    expect(dropIndex(slots, { x: 2000, y: 2000 }, 0)).toBe(3)
  })

  it('keeps the current index without slots or with a bad point', () => {
    expect(dropIndex([], { x: 0, y: 0 }, 2)).toBe(2)
    expect(dropIndex(slots, { x: Number.NaN, y: 0 }, 1)).toBe(1)
  })

  it('always returns a valid slot for any finite point', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 5 }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        (count, columns, x, y) => {
          const index = dropIndex(grid(count, columns), { x, y }, 0)
          expect(index).toBeGreaterThanOrEqual(0)
          expect(index).toBeLessThan(count)
        },
      ),
    )
  })
})

describe('dragTranslation', () => {
  const slots = grid(4, 2)

  it('keeps the grabbed point under the pointer for the current slot', () => {
    // Grabbed 10px into the card's corner; the pointer moved to (500, 300); the card sits in slot 3.
    const t = dragTranslation(slots, 3, { x: 500, y: 300 }, { x: 10, y: 10 })
    const slot = slots[3]
    expect(slot).toBeDefined()
    if (!slot) return
    expect(slot.left + t.x + 10).toBe(500)
    expect(slot.top + t.y + 10).toBe(300)
  })

  it('is zero when the pointer has not moved from where it grabbed', () => {
    const slot = slots[1]
    if (!slot) throw new Error('missing slot')
    const grab = { x: 40, y: 25 }
    const t = dragTranslation(slots, 1, { x: slot.left + grab.x, y: slot.top + grab.y }, grab)
    expect(t).toEqual({ x: 0, y: 0 })
  })

  it('is zero for an unknown slot', () => {
    expect(dragTranslation(slots, 9, { x: 1, y: 1 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
  })
})

describe('edgeScroll', () => {
  it('is zero away from the edges', () => {
    expect(edgeScroll(400, 800)).toBe(0)
  })

  it('scrolls up near the top and down near the bottom, fastest at the edge', () => {
    expect(edgeScroll(0, 800)).toBe(-24)
    expect(edgeScroll(24, 800)).toBe(-12)
    expect(edgeScroll(800, 800)).toBe(24)
    expect(edgeScroll(776, 800)).toBe(12)
  })

  it('caps the step beyond the viewport', () => {
    expect(edgeScroll(-500, 800)).toBe(-24)
    expect(edgeScroll(5000, 800)).toBe(24)
  })

  it('is zero for bad input', () => {
    expect(edgeScroll(Number.NaN, 800)).toBe(0)
    expect(edgeScroll(10, 0)).toBe(0)
    expect(edgeScroll(10, 800, 0)).toBe(0)
  })
})
