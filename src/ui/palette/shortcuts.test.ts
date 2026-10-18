import { afterEach, describe, expect, it } from 'vitest'

import { keymap } from '../../core'
import { setAppLocale } from '../../i18n'
import {
  comboLabels,
  HELP_SECTIONS,
  helpSectionSpecs,
  helpSections,
  shortcutLabel,
} from './shortcuts'

const DEFAULTS = keymap.DEFAULT_BINDINGS

describe('comboLabels', () => {
  it('formats the default bindings for each platform', () => {
    expect(comboLabels(DEFAULTS, 'toggle', 'other')).toEqual(['Space'])
    expect(comboLabels(DEFAULTS, 'palette', 'other')).toEqual(['Ctrl+K'])
    expect(comboLabels(DEFAULTS, 'palette', 'mac')).toEqual(['⌘K'])
    expect(comboLabels(DEFAULTS, 'undo', 'mac')).toEqual(['⌘Z'])
    expect(comboLabels(DEFAULTS, 'newStopwatch', 'other')).toEqual(['Shift+N'])
    expect(comboLabels(DEFAULTS, 'help', 'other')).toEqual(['?'])
    expect(comboLabels(DEFAULTS, 'cancel', 'other')).toEqual(['Esc'])
    expect(comboLabels(DEFAULTS, 'moveLeft', 'mac')).toEqual(['⌃←'])
  })

  it('formats every default binding', () => {
    for (const action of keymap.ACTION_IDS) {
      const labels = comboLabels(DEFAULTS, action, 'other')
      expect(labels).toHaveLength(DEFAULTS[action].length)
    }
  })

  it('lists several combos in order, skipping malformed and repeated ones', () => {
    const bindings = { ...DEFAULTS, reset: ['r', 'Bogus+Key', 'Shift+R', 'R'] }
    expect(comboLabels(bindings, 'reset', 'other')).toEqual(['R', 'Shift+R'])
  })

  it('gives an empty list for an unbound action or broken settings', () => {
    expect(comboLabels(DEFAULTS, 'dismiss', 'other')).toEqual([])
    const broken = { ...DEFAULTS, reset: 'r' } as unknown as keymap.Bindings
    expect(comboLabels(broken, 'reset', 'other')).toEqual([])
  })
})

describe('shortcutLabel', () => {
  it('is the first combo, or null', () => {
    expect(shortcutLabel(DEFAULTS, 'rename', 'other')).toBe('F2')
    expect(shortcutLabel(DEFAULTS, 'dismiss', 'other')).toBeNull()
  })
})

describe('HELP_SECTIONS', () => {
  it('covers every action except the hidden mini window', () => {
    const listed = new Set(HELP_SECTIONS.flatMap((s) => s.rows.flatMap((r) => r.actions ?? [])))
    const missing = keymap.ACTION_IDS.filter((action) => !listed.has(action))
    expect(missing).toEqual(['miniWindow'])
  })

  it('lists the mini window, after fullscreen, where the platform has one', () => {
    const listed = new Set(
      helpSectionSpecs(true).flatMap((s) => s.rows.flatMap((r) => r.actions ?? [])),
    )
    expect(keymap.ACTION_IDS.filter((action) => !listed.has(action))).toEqual([])
    const cards = helpSectionSpecs(true).find((s) => s.title() === 'Cards')
    const labels = cards?.rows.map((r) => r.label()) ?? []
    expect(labels.slice(labels.indexOf('Fullscreen'), labels.indexOf('Fullscreen') + 2)).toEqual([
      'Fullscreen',
      'Open the mini window',
    ])
    expect(
      helpSections(DEFAULTS, 'other', helpSectionSpecs(true)).flatMap((s) => s.rows),
    ).toContainEqual({ label: 'Open the mini window', keys: ['T'] })
  })

  it('has unique row labels within each section, in the planned groups', () => {
    expect(HELP_SECTIONS.map((s) => s.title())).toEqual([
      'Timer',
      'Stopwatch',
      'Cards',
      'Navigation',
      'App',
    ])
    for (const section of HELP_SECTIONS) {
      const labels = section.rows.map((r) => r.label())
      expect(new Set(labels).size).toBe(labels.length)
    }
  })
})

describe('helpSections', () => {
  it('shows the fixed digit-entry keys first', () => {
    const [timer] = helpSections(DEFAULTS, 'other')
    expect(timer?.rows.slice(0, 2)).toEqual([
      { label: 'Type a duration', keys: ['0–9'] },
      { label: 'Delete the last digit', keys: ['Backspace'] },
    ])
  })

  it('leaves out rows with no key, such as the unbound dismiss action', () => {
    const labels = helpSections(DEFAULTS, 'other').flatMap((s) => s.rows.map((r) => r.label))
    expect(labels).not.toContain('Dismiss the alarm')
    const bound = helpSections({ ...DEFAULTS, dismiss: ['d'] }, 'other')
    expect(bound[0]?.rows).toContainEqual({ label: 'Dismiss the alarm', keys: ['D'] })
  })

  it('shows the first combo of each action in a multi-action row, sharing modifiers', () => {
    const navigation = helpSections(DEFAULTS, 'other').find((s) => s.title === 'Navigation')
    expect(navigation?.rows).toEqual([
      { label: 'Select a card', keys: ['←', '→', '↑', '↓'] },
      { label: 'Move the card', modifier: 'Ctrl', keys: ['←', '→', '↑', '↓'] },
    ])
    const mac = helpSections(DEFAULTS, 'mac').find((s) => s.title === 'Navigation')
    expect(mac?.rows[1]).toEqual({
      label: 'Move the card',
      modifier: '⌃',
      keys: ['←', '→', '↑', '↓'],
    })
  })

  it('pulls out several shared modifiers, but not modifiers that differ', () => {
    const shared = {
      ...DEFAULTS,
      moveLeft: ['Ctrl+Shift+ArrowLeft', 'h'],
      moveRight: ['Ctrl+Shift+ArrowRight'],
      moveUp: ['Ctrl+Shift+ArrowUp'],
      moveDown: ['Ctrl+Shift+ArrowDown'],
    }
    const row = (bindings: keymap.Bindings) =>
      helpSections(bindings, 'other')
        .find((s) => s.title === 'Navigation')
        ?.rows.find((r) => r.label === 'Move the card')
    expect(row(shared)).toEqual({
      label: 'Move the card',
      modifier: 'Ctrl+Shift',
      keys: ['←', '→', '↑', '↓'],
    })
    expect(row({ ...DEFAULTS, moveUp: ['Alt+ArrowUp'] })).toEqual({
      label: 'Move the card',
      keys: ['Ctrl+←', 'Ctrl+→', 'Alt+↑', 'Ctrl+↓'],
    })
    expect(row({ ...DEFAULTS, moveLeft: [], moveRight: [], moveUp: [] })).toEqual({
      label: 'Move the card',
      keys: ['Ctrl+↓'],
    })
  })

  it('shows every combo of a single-action row', () => {
    const cardsSection = helpSections({ ...DEFAULTS, newTimer: ['n', 'Insert'] }, 'other').find(
      (s) => s.title === 'Cards',
    )
    expect(cardsSection?.rows[0]).toEqual({ label: 'New timer', keys: ['N', 'Insert'] })
  })

  it('lists Settings in the App section, on Mod+,', () => {
    const app = (platform: keymap.Platform) =>
      helpSections(DEFAULTS, platform).find((s) => s.title === 'App')?.rows
    expect(app('other')).toContainEqual({ label: 'Settings', keys: ['Ctrl+,'] })
    expect(app('mac')).toContainEqual({ label: 'Settings', keys: ['⌘,'] })
  })

  it('drops a section left with no rows', () => {
    const sections = helpSections(DEFAULTS, 'other', [
      { title: () => 'Empty', rows: [{ label: () => 'Nothing', actions: ['dismiss'] }] },
      { title: () => 'Kept', rows: [{ label: () => 'Lap', actions: ['lap'] }] },
    ])
    expect(sections).toEqual([{ title: 'Kept', rows: [{ label: 'Lap', keys: ['L'] }] }])
  })
})

describe('helpSections in other locales', () => {
  afterEach(() => {
    setAppLocale('en')
  })

  it('titles sections and rows in the locale active when it runs, keeping key labels', () => {
    setAppLocale('ja')
    const [timer, , , navigation] = helpSections(DEFAULTS, 'other')
    expect(timer?.title).toBe('タイマー')
    expect(timer?.rows[0]).toEqual({ label: '時間を入力', keys: ['0–9'] })
    expect(navigation?.rows[1]).toEqual({
      label: 'カードを移動',
      modifier: 'Ctrl',
      keys: ['←', '→', '↑', '↓'],
    })
    setAppLocale('zh-TW')
    expect(helpSections(DEFAULTS, 'mac').map((s) => s.title)).toEqual([
      '計時器',
      '碼錶',
      '卡片',
      '導覽',
      '應用程式',
    ])
  })

  it('keeps row labels unique within each section in every locale', () => {
    for (const locale of ['en', 'zh-TW', 'ja'] as const) {
      setAppLocale(locale)
      for (const section of helpSections(DEFAULTS, 'other')) {
        const labels = section.rows.map((r) => r.label)
        expect(new Set(labels).size, `${locale} ${section.title}`).toBe(labels.length)
      }
    }
  })
})
