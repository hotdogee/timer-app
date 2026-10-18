import { afterEach, describe, expect, it } from 'vitest'

import { keymap, settings } from '../../core'
import { setAppLocale } from '../../i18n'
import { HOTKEY_RESULTS } from '../../platform'
import {
  CLOSE_BEHAVIOR_LABELS,
  HOTKEY_LABELS,
  classifyHotkey,
  hotkeyLabel,
  needsModifierMessage,
  hotkeyResultMessage,
} from './desktop'

afterEach(() => {
  setAppLocale('en')
})

function combo(key: string, mods: Partial<Omit<keymap.KeyCombo, 'key'>> = {}): keymap.KeyCombo {
  return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods }
}

const NONE = settings.DESKTOP_DEFAULTS.hotkeys

describe('classifyHotkey', () => {
  it('takes a combo with Ctrl, Alt or Meta, in the portable form', () => {
    expect(
      classifyHotkey(NONE, 'toggleLast', combo(' ', { ctrl: true, shift: true }), 'other'),
    ).toEqual({ kind: 'ok', label: 'Ctrl+Shift+Space', text: 'Mod+Shift+Space' })
    expect(classifyHotkey(NONE, 'showApp', combo('t', { meta: true, alt: true }), 'mac')).toEqual({
      kind: 'ok',
      label: '⌥⌘T',
      text: 'Mod+Alt+t',
    })
    expect(classifyHotkey(NONE, 'showApp', combo('F9', { alt: true }), 'other')).toMatchObject({
      kind: 'ok',
      text: 'Alt+F9',
    })
  })

  it('refuses keys without Ctrl, Alt or Meta, Shift included', () => {
    for (const pressed of [combo('t'), combo('t', { shift: true }), combo('F9')]) {
      expect(classifyHotkey(NONE, 'toggleLast', pressed, 'other').kind).toBe('needs-modifier')
    }
  })

  it('refuses what cannot be a shortcut at all', () => {
    expect(classifyHotkey(NONE, 'toggleLast', combo('5'), 'other')).toEqual({
      kind: 'reserved',
      label: '5',
    })
    expect(classifyHotkey(NONE, 'toggleLast', combo('Control', { ctrl: true }), 'other').kind).toBe(
      'reserved',
    )
  })

  it('drops Shift from characters whose Shift depends on the layout', () => {
    expect(
      classifyHotkey(NONE, 'toggleLast', combo('?', { ctrl: true, shift: true }), 'other'),
    ).toMatchObject({ kind: 'ok', text: 'Mod+?' })
  })

  it("refuses the other hotkey's combo, but not its own", () => {
    const bound = { toggleLast: 'Mod+Shift+Space', showApp: null }
    const pressed = combo(' ', { ctrl: true, shift: true })
    expect(classifyHotkey(bound, 'showApp', pressed, 'other')).toEqual({
      kind: 'conflict',
      label: 'Ctrl+Shift+Space',
      other: 'toggleLast',
    })
    expect(classifyHotkey(bound, 'toggleLast', pressed, 'other').kind).toBe('ok')
  })
})

describe('hotkey text', () => {
  it('labels a stored combo for the platform, or null', () => {
    expect(hotkeyLabel('Mod+Shift+Space', 'other')).toBe('Ctrl+Shift+Space')
    expect(hotkeyLabel('Mod+Shift+Space', 'mac')).toBe('⇧⌘Space')
    expect(hotkeyLabel(null, 'other')).toBeNull()
    expect(hotkeyLabel('Bogus+Key', 'other')).toBeNull()
  })

  it('names the modifiers a hotkey needs as the key labels do, spaced in every language', () => {
    expect(needsModifierMessage('other')).toBe('Global shortcuts need Ctrl, Alt or Meta')
    expect(needsModifierMessage('mac')).toBe('Global shortcuts need ⌘, ⌥ or ⌃')
    setAppLocale('ja')
    expect(needsModifierMessage('other')).toBe(
      'グローバルショートカットには Ctrl、Alt、Meta のいずれかを含めてください',
    )
    setAppLocale('zh-TW')
    expect(needsModifierMessage('other')).toBe('全域快速鍵必須包含 Ctrl、Alt 或 Meta')
  })

  it('has a message for every registration result but ok', () => {
    for (const result of HOTKEY_RESULTS) {
      const text = hotkeyResultMessage(result, 'Ctrl+K')
      if (result === 'ok') expect(text).toBe('')
      else expect(text).not.toBe('')
    }
    expect(hotkeyResultMessage('taken', 'Ctrl+K')).toBe('Another app uses Ctrl+K')
    expect(hotkeyResultMessage('invalid', 'Ctrl+K')).toBe(
      "Ctrl+K can't be used as a global shortcut",
    )
  })

  it('names every close behavior and hotkey, in the active locale', () => {
    expect(settings.CLOSE_BEHAVIORS.map((value) => CLOSE_BEHAVIOR_LABELS[value]('other'))).toEqual([
      'Hide to the tray while a timer runs',
      'Always hide to the tray',
      'Quit',
    ])
    // A Mac has the menu bar.
    expect(settings.CLOSE_BEHAVIORS.map((value) => CLOSE_BEHAVIOR_LABELS[value]('mac'))).toEqual([
      'Hide to the menu bar while a timer runs',
      'Always hide to the menu bar',
      'Quit',
    ])
    setAppLocale('ja')
    expect(settings.HOTKEY_IDS.map((id) => HOTKEY_LABELS[id]())).toEqual([
      '最後に使ったカードを開始 / 一時停止',
      'Timer App を表示 / 非表示',
    ])
  })
})
