import { afterEach, describe, expect, it } from 'vitest'

import { setAppLocale } from '../../i18n'
import { SETTINGS_ICON_NAMES, glyphPath } from './icons'
import {
  SECTION_ICONS,
  SECTION_IDS,
  isSectionId,
  sectionTitle,
  tabId,
  tabKeyTarget,
} from './sections'

afterEach(() => {
  setAppLocale('en')
})

describe('sections', () => {
  it('lists the sections in display order', () => {
    expect(SECTION_IDS).toEqual([
      'appearance',
      'behavior',
      'keyboard',
      'presets',
      'data',
      'account',
      'about',
    ])
    expect(Object.isFrozen(SECTION_IDS)).toBe(true)
  })

  it('titles each section in the active locale', () => {
    expect(SECTION_IDS.map(sectionTitle)).toEqual([
      'Appearance',
      'Behavior',
      'Keyboard',
      'Presets',
      'Data',
      'Account',
      'About',
    ])
    setAppLocale('zh-TW')
    expect(sectionTitle('presets')).toBe('預設集')
    expect(sectionTitle('account')).toBe('帳號')
  })

  it('has an icon with path data for each section', () => {
    for (const id of SECTION_IDS) expect(glyphPath(SECTION_ICONS[id])).toMatch(/^M/)
  })

  it('recognizes section ids', () => {
    expect(isSectionId('keyboard')).toBe(true)
    expect(isSectionId('account')).toBe(true)
    expect(isSectionId('desktop')).toBe(false)
    expect(isSectionId(undefined)).toBe(false)
  })

  it('makes tab ids from a prefix', () => {
    expect(tabId('s1', 'data')).toBe('s1-tab-data')
  })
})

describe('tabKeyTarget', () => {
  it('moves with every arrow, wrapping around', () => {
    expect(tabKeyTarget('ArrowDown', 0, 6)).toBe(1)
    expect(tabKeyTarget('ArrowRight', 5, 6)).toBe(0)
    expect(tabKeyTarget('ArrowUp', 0, 6)).toBe(5)
    expect(tabKeyTarget('ArrowLeft', 3, 6)).toBe(2)
  })

  it('jumps with Home and End', () => {
    expect(tabKeyTarget('Home', 4, 6)).toBe(0)
    expect(tabKeyTarget('End', 1, 6)).toBe(5)
  })

  it('ignores other keys, empty lists and clamps a bad index', () => {
    expect(tabKeyTarget('Enter', 0, 6)).toBeNull()
    expect(tabKeyTarget('ArrowDown', 0, 0)).toBeNull()
    expect(tabKeyTarget('ArrowDown', -1, 3)).toBe(1)
    expect(tabKeyTarget('ArrowDown', 9, 3)).toBe(0)
    expect(tabKeyTarget('ArrowUp', Number.NaN, 3)).toBe(2)
  })
})

describe('settings icons', () => {
  it('has path data for every icon and reads the app set too', () => {
    // Path data starts with a moveto, absolute (M) or relative (m).
    for (const name of SETTINGS_ICON_NAMES) expect(glyphPath(name)).toMatch(/^[Mm]/)
    expect(glyphPath('keyboard')).toMatch(/^M/)
    expect(new Set(SETTINGS_ICON_NAMES.map(glyphPath)).size).toBe(SETTINGS_ICON_NAMES.length)
  })
})
