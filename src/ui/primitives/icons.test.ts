import { describe, expect, it } from 'vitest'

import { ICON_NAMES, iconPath, type IconName } from './icons'

/** The set the milestone plan asks for (Design decisions › Icons, P1-A). */
const REQUIRED: readonly IconName[] = [
  'hourglass_top',
  'timer',
  'volume_up',
  'volume_off',
  'fullscreen',
  'fullscreen_exit',
  'picture_in_picture_alt',
  'play_arrow',
  'pause',
  'restart_alt',
  'flag',
  'add',
  'edit',
  'delete',
  'drag_indicator',
  'check',
  'close',
  'search',
  'keyboard',
  'notifications',
  'undo',
  'more_vert',
  'done',
]

describe('icons', () => {
  it('has exactly the planned set', () => {
    expect([...ICON_NAMES].sort()).toEqual([...REQUIRED].sort())
  })

  it('extracts non-empty path data for every icon', () => {
    for (const name of ICON_NAMES) {
      // SVG path data: starts with a move, then only commands and numbers (no markup).
      expect(iconPath(name), name).toMatch(/^[Mm][-\d.]+[A-Za-z\d.,\s-]+$/)
    }
  })

  it('gives distinct glyphs, except done, which is check', () => {
    const paths = ICON_NAMES.filter((name) => name !== 'done').map(iconPath)
    expect(new Set(paths).size).toBe(paths.length)
    expect(iconPath('done')).toBe(iconPath('check'))
  })

  it('uses the filled glyphs for play and pause', () => {
    // The filled play arrow is a single closed triangle; the outlined one adds an inner contour.
    expect(iconPath('play_arrow').match(/Z/g)).toHaveLength(1)
  })
})
