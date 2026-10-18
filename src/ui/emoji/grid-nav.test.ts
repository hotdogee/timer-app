import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { LEAVE_UP, moveInGrids, type GridPosition } from './grid-nav'

/** Three grids of 4 columns: 10 emoji (rows of 4, 4, 2), 3 (one short row) and 8 (two rows). */
const SIZES = [10, 3, 8]

const at = (grid: number, index: number): GridPosition => ({ grid, index })
const move = (from: GridPosition, key: string, toEnds = false) =>
  moveInGrids(SIZES, from, key, 4, toEnds)

describe('moveInGrids', () => {
  it('steps left and right, across grids, and stops at the very ends', () => {
    expect(move(at(0, 3), 'ArrowRight')).toEqual(at(0, 4))
    expect(move(at(0, 9), 'ArrowRight')).toEqual(at(1, 0))
    expect(move(at(1, 0), 'ArrowLeft')).toEqual(at(0, 9))
    expect(move(at(0, 0), 'ArrowLeft')).toEqual(at(0, 0))
    expect(move(at(2, 7), 'ArrowRight')).toEqual(at(2, 7))
  })

  it('moves a row up and down, keeping the column', () => {
    expect(move(at(0, 1), 'ArrowDown')).toEqual(at(0, 5))
    expect(move(at(0, 5), 'ArrowUp')).toEqual(at(0, 1))
    // Into a shorter last row: its last emoji.
    expect(move(at(0, 7), 'ArrowDown')).toEqual(at(0, 9))
  })

  it('goes down into the next grid’s first row and up into the previous grid’s last row', () => {
    expect(move(at(0, 9), 'ArrowDown')).toEqual(at(1, 1))
    expect(move(at(0, 8), 'ArrowDown')).toEqual(at(1, 0))
    // Column 3 is past the next grid's 2 emoji: its last one.
    expect(moveInGrids([4, 2], at(0, 3), 'ArrowDown', 4)).toEqual(at(1, 1))
    expect(move(at(1, 2), 'ArrowDown')).toEqual(at(2, 2))
    expect(move(at(2, 3), 'ArrowUp')).toEqual(at(1, 2))
    expect(move(at(1, 1), 'ArrowUp')).toEqual(at(0, 9))
    expect(move(at(1, 0), 'ArrowUp')).toEqual(at(0, 8))
    expect(move(at(2, 6), 'ArrowDown')).toEqual(at(2, 6))
  })

  it('leaves upward from the very first row', () => {
    expect(move(at(0, 0), 'ArrowUp')).toBe(LEAVE_UP)
    expect(move(at(0, 3), 'ArrowUp')).toBe(LEAVE_UP)
  })

  it('goes to the row’s ends with Home and End, and to all ends with Ctrl', () => {
    expect(move(at(0, 6), 'Home')).toEqual(at(0, 4))
    expect(move(at(0, 6), 'End')).toEqual(at(0, 7))
    expect(move(at(0, 8), 'End')).toEqual(at(0, 9))
    expect(move(at(1, 2), 'Home', true)).toEqual(at(0, 0))
    expect(move(at(1, 2), 'End', true)).toEqual(at(2, 7))
  })

  it('skips empty grids', () => {
    const sizes = [2, 0, 2]
    expect(moveInGrids(sizes, at(0, 1), 'ArrowRight', 2)).toEqual(at(2, 0))
    expect(moveInGrids(sizes, at(2, 0), 'ArrowUp', 2)).toEqual(at(0, 0))
    expect(moveInGrids([0, 3], at(1, 2), 'Home', 3, true)).toEqual(at(1, 0))
  })

  it('ignores other keys and positions outside the grids', () => {
    expect(move(at(0, 0), 'Enter')).toBeNull()
    expect(move(at(0, 0), 'a')).toBeNull()
    expect(move(at(0, 10), 'ArrowLeft')).toBeNull()
    expect(move(at(5, 0), 'ArrowLeft')).toBeNull()
    expect(move(at(0, -1), 'ArrowLeft')).toBeNull()
  })

  it('treats fewer than one column as one', () => {
    expect(moveInGrids([3], at(0, 0), 'ArrowDown', 0)).toEqual(at(0, 1))
    expect(moveInGrids([3], at(0, 0), 'ArrowDown', Number.NaN)).toEqual(at(0, 1))
  })

  it('always lands on an emoji (property)', () => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 12 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 6 }),
        fc.nat(),
        fc.constantFrom(...keys),
        fc.boolean(),
        (sizes, columns, seed, key, toEnds) => {
          const grids = sizes.flatMap((size, grid) => (size > 0 ? [grid] : []))
          const grid = grids[seed % Math.max(1, grids.length)]
          if (grid === undefined) return
          const from = at(grid, seed % (sizes[grid] ?? 1))
          const to = moveInGrids(sizes, from, key, columns, toEnds)
          if (to === null) throw new Error('a move key was ignored')
          if (to === LEAVE_UP) return
          expect(to.index).toBeGreaterThanOrEqual(0)
          expect(to.index).toBeLessThan(sizes[to.grid] ?? 0)
        },
      ),
    )
  })
})
