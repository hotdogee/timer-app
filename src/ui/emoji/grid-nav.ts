/**
 * Arrow-key movement over the emoji picker's grids: a grid per group, one under the other, each
 * filled row by row with `columns` columns (or a single grid of search results). Pure; the
 * picker measures the columns and moves focus.
 *
 * Left and Right step through the emoji, from one grid's end into the next one's start and back.
 * Up and Down move a row, keeping the column: down from a grid's last row into the next grid's
 * first row, up from a grid's first row into the previous grid's last row (a shorter row ends at
 * its last emoji). Home and End go to the start and end of the row; with Ctrl (or ⌘), to the first
 * and last emoji of all. Up from the very first row leaves the grids (the picker returns to the
 * search field); every other move at an edge stays put.
 */

/** An emoji's place: which grid (only grids with emoji count) and its index in that grid. */
export interface GridPosition {
  readonly grid: number
  readonly index: number
}

/** Up from the first row: focus goes back above the grids. */
export const LEAVE_UP = 'leave-up'

/** The next grid after (`step` 1) or before (-1) `from` that has emoji, or -1. */
function neighborGrid(sizes: readonly number[], from: number, step: 1 | -1): number {
  for (let grid = from + step; grid >= 0 && grid < sizes.length; grid += step) {
    if ((sizes[grid] ?? 0) > 0) return grid
  }
  return -1
}

/**
 * Where `key` moves focus from `at` over grids of `sizes` emoji with `columns` columns (floored;
 * fewer than 1, or NaN, count as 1): a position (`at` itself at an edge), {@link LEAVE_UP}, or
 * null for a key that is not a move, and for a position outside the grids.
 */
export function moveInGrids(
  sizes: readonly number[],
  at: GridPosition,
  key: string,
  columns: number,
  toEnds = false,
): GridPosition | typeof LEAVE_UP | null {
  const size = sizes[at.grid] ?? 0
  if (!Number.isInteger(at.index) || at.index < 0 || at.index >= size) return null
  const cols = Math.max(1, Math.floor(columns) || 1)
  const { grid, index } = at
  const column = index % cols
  const rowStart = index - column
  switch (key) {
    case 'ArrowRight': {
      if (index + 1 < size) return { grid, index: index + 1 }
      const next = neighborGrid(sizes, grid, 1)
      return next < 0 ? at : { grid: next, index: 0 }
    }
    case 'ArrowLeft': {
      if (index > 0) return { grid, index: index - 1 }
      const previous = neighborGrid(sizes, grid, -1)
      return previous < 0 ? at : { grid: previous, index: (sizes[previous] ?? 1) - 1 }
    }
    case 'ArrowDown': {
      if (index + cols < size) return { grid, index: index + cols }
      // A shorter last row below this one: its last emoji.
      if (rowStart + cols < size) return { grid, index: size - 1 }
      const next = neighborGrid(sizes, grid, 1)
      return next < 0 ? at : { grid: next, index: Math.min(column, (sizes[next] ?? 1) - 1) }
    }
    case 'ArrowUp': {
      if (index >= cols) return { grid, index: index - cols }
      const previous = neighborGrid(sizes, grid, -1)
      if (previous < 0) return LEAVE_UP
      const length = sizes[previous] ?? 1
      const lastRow = Math.floor((length - 1) / cols) * cols
      return { grid: previous, index: Math.min(lastRow + column, length - 1) }
    }
    case 'Home': {
      if (!toEnds) return { grid, index: rowStart }
      return { grid: neighborGrid(sizes, -1, 1), index: 0 }
    }
    case 'End': {
      if (!toEnds) return { grid, index: Math.min(rowStart + cols, size) - 1 }
      const last = neighborGrid(sizes, sizes.length, -1)
      return { grid: last, index: (sizes[last] ?? 1) - 1 }
    }
    default:
      return null
  }
}
