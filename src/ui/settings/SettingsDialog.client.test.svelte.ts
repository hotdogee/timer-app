/**
 * The settings dialog against real stores (in-memory TinyBase, no persisters), in jsdom with
 * Svelte's browser runtime: every control writes its setting, resets restore defaults, the
 * shortcut recorder, the presets editor and import/export behave, and closing works every way.
 * Native keyboard behavior of radios, ranges and selects is the browser's and is checked in a
 * real browser; here events are dispatched directly.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { exportFormat, settings, type keymap } from '../../core'
import { setAppLocale } from '../../i18n'
import type { NotificationPermissionState } from '../../platform'
import { BUILTIN_PRESETS } from '../../state/presets'
import { createPresetStore } from '../../state/presets.svelte'
import { createSettingsStore } from '../../state/settings.svelte'
import { createAppStores } from '../../sync/stores'
import { currentAnnouncement } from '../announce.svelte'
import type { SectionId } from './sections'
import SettingsDialog from './SettingsDialog.svelte'

beforeAll(() => {
  // jsdom has <dialog> and its `open` attribute, but not the modal API or scrolling into view.
  const dialog = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
  if (typeof dialog.showModal !== 'function') {
    dialog.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  }
  if (typeof dialog.close !== 'function') {
    dialog.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
  const element = Element.prototype as Partial<Element>
  if (typeof element.scrollIntoView !== 'function') {
    element.scrollIntoView = () => undefined
  }
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  setAppLocale('en')
})

async function setup(
  options: {
    section?: SectionId
    keyPlatform?: keymap.Platform
    permission?: NotificationPermissionState
  } = {},
) {
  const stores = createAppStores()
  const settingsStore = createSettingsStore(stores)
  let next = 0
  const presetStore = createPresetStore(stores.synced, { newId: () => `p${String(++next)}` })
  for (const preset of BUILTIN_PRESETS) presetStore.add(preset.name, preset.duration)
  let permission: NotificationPermissionState = options.permission ?? 'default'
  const notifier = {
    permission: vi.fn(() => permission),
    request: vi.fn(() => {
      permission = 'denied'
      return Promise.resolve(false)
    }),
  }
  const calls = {
    onexport: vi.fn(),
    onimport: vi.fn<(data: exportFormat.ExportData) => void>(),
    onclose: vi.fn(),
    previewSound: vi.fn<(sound: settings.SoundId, volume: number) => void>(),
  }
  const section: SectionId = options.section ?? 'appearance'
  const state = $state({ open: true, section })
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(SettingsDialog, {
    target,
    props: {
      get open() {
        return state.open
      },
      set open(value: boolean) {
        state.open = value
      },
      get section() {
        return state.section
      },
      set section(value: SectionId) {
        state.section = value
      },
      settingsStore,
      presetStore,
      cardCount: 2,
      keyPlatform: options.keyPlatform ?? 'other',
      platformKind: 'web',
      version: '1.2.3',
      notifier,
      ...calls,
    },
  })
  cleanups.push(() => {
    void unmount(app)
    target.remove()
    settingsStore.destroy()
    presetStore.destroy()
  })
  // Let the dialog finish opening (it focuses the current tab), as a user would.
  await settle()
  return { stores, settingsStore, presetStore, state, target, notifier, ...calls }
}

function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`No element matches ${selector}`)
  return element
}

/** The control a visible `<label>` with exactly this text names. */
function labelled<T extends HTMLElement = HTMLElement>(root: ParentNode, text: string): T {
  const label = [...root.querySelectorAll('label')].find((l) => l.textContent.trim() === text)
  const control = label === undefined ? null : document.getElementById(label.htmlFor)
  if (control === null) throw new Error(`No control labelled ${text}`)
  return control as T
}

function byName<T extends HTMLElement = HTMLElement>(root: ParentNode, name: string): T {
  return query<T>(root, `[aria-label="${name}"]`)
}

/** The button whose visible text is exactly `text`. */
function button(root: ParentNode | undefined, text: string): HTMLButtonElement {
  const found = [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (b) => b.textContent.trim() === text,
  )
  if (found === undefined) throw new Error(`No button ${text}`)
  return found
}

function tab(root: ParentNode, title: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (t) => t.textContent.trim() === title,
  )
  if (found === undefined) throw new Error(`No tab ${title}`)
  return found
}

function key(target: Element, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  flushSync()
  return event
}

function input(element: HTMLInputElement | HTMLSelectElement, value: string, type = 'input') {
  element.value = value
  element.dispatchEvent(new Event(type, { bubbles: true }))
  flushSync()
}

function click(element: HTMLElement) {
  element.click()
  flushSync()
}

async function settle() {
  await tick()
  await Promise.resolve()
  flushSync()
}

describe('the dialog', () => {
  it('opens on a section, named by its title, with focus on that section’s tab', async () => {
    const { target } = await setup()
    const dialog = query<HTMLDialogElement>(target, 'dialog')
    expect(dialog.open).toBe(true)
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent).toBe('Settings')
    const tabs = [...target.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
    expect(tabs).toEqual(['Appearance', 'Behavior', 'Keyboard', 'Presets', 'Data', 'About'])
    expect(query(target, '[role="tablist"]').getAttribute('aria-label')).toBe('Settings sections')
    await settle()
    expect(document.activeElement).toBe(tab(target, 'Appearance'))
    const panel = query(target, '[role="tabpanel"]')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab(target, 'Appearance').id)
    expect(tab(target, 'Appearance').getAttribute('aria-controls')).toBe(panel.id)
  })

  it('switches sections by click and by arrow keys, with one tab in the Tab order', async () => {
    const { target, state } = await setup()
    click(tab(target, 'Keyboard'))
    expect(state.section).toBe('keyboard')
    expect(query(target, '[role="tabpanel"] h3').textContent).toBe('Keyboard')
    expect(tab(target, 'Keyboard').getAttribute('aria-selected')).toBe('true')
    expect(tab(target, 'Keyboard').tabIndex).toBe(0)
    expect(tab(target, 'Appearance').tabIndex).toBe(-1)
    key(tab(target, 'Keyboard'), { key: 'ArrowDown' })
    await settle()
    expect(state.section).toBe('presets')
    expect(document.activeElement).toBe(tab(target, 'Presets'))
    key(tab(target, 'Presets'), { key: 'End' })
    expect(state.section).toBe('about')
    key(tab(target, 'About'), { key: 'ArrowRight' })
    expect(state.section).toBe('appearance')
    key(tab(target, 'Appearance'), { key: 'ArrowUp', ctrlKey: true })
    expect(state.section).toBe('appearance')
  })

  it('closes with the close button and tells the app', async () => {
    const { target, state, onclose } = await setup()
    click(byName(target, 'Close'))
    expect(state.open).toBe(false)
    expect(query<HTMLDialogElement>(target, 'dialog').open).toBe(false)
    expect(onclose).toHaveBeenCalledTimes(1)
    expect(target.querySelector('[role="tabpanel"]')).toBeNull()
  })

  it('closes with the settings shortcut, as the palette shortcut closes the palette', async () => {
    const { target, state } = await setup()
    const event = key(tab(target, 'Appearance'), { key: ',', ctrlKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(state.open).toBe(false)
  })

  it('leaves a bare-key settings shortcut to a focused text field, and closes on it elsewhere', async () => {
    const { target, state, settingsStore } = await setup({ section: 'presets' })
    settingsStore.updateSynced({ keymap: { settings: ['s'] } })
    flushSync()
    const name = byName<HTMLInputElement>(target, 'Preset name')
    const typed = key(name, { key: 's' })
    expect(typed.defaultPrevented).toBe(false)
    expect(state.open).toBe(true)
    // With Ctrl, Alt or Meta it is a shortcut even in a text field: the default Mod+, still closes.
    settingsStore.updateSynced({ keymap: {} })
    flushSync()
    key(name, { key: ',', ctrlKey: true })
    expect(state.open).toBe(false)
    state.open = true
    await settle()
    settingsStore.updateSynced({ keymap: { settings: ['s'] } })
    flushSync()
    key(tab(target, 'Presets'), { key: 's' })
    expect(state.open).toBe(false)
  })

  it('leaves the settings shortcut to the page once it has closed', async () => {
    const { target, state } = await setup()
    const dialog = query<HTMLDialogElement>(target, 'dialog')
    click(byName(target, 'Close'))
    expect(state.open).toBe(false)
    // Focus can still be inside the closed dialog for a moment; Mod+, then reopens it (App).
    const event = key(dialog, { key: ',', ctrlKey: true })
    expect(event.defaultPrevented).toBe(false)
  })

  it('follows the active locale without reopening', async () => {
    const { target } = await setup()
    const first = query(target, '[role="tab"]')
    setAppLocale('ja')
    flushSync()
    expect(first.textContent.trim()).toBe('外観')
    expect(query(target, '[role="tab"]')).toBe(first)
    expect(byName(target, '閉じる')).toBeTruthy()
  })
})

describe('Appearance', () => {
  it('writes each control to the device settings', async () => {
    const { target, settingsStore } = await setup()
    click(query(target, 'input[type="radio"][value="dark"]'))
    expect(settingsStore.device.themeMode).toBe('dark')
    input(labelled<HTMLSelectElement>(target, 'Font'), 'inter', 'change')
    expect(settingsStore.device.font).toBe('inter')
    const size = labelled<HTMLInputElement>(target, 'Digit size')
    input(size, '1.25')
    expect(settingsStore.device.digitScale).toBe(1.25)
    expect(size.getAttribute('aria-valuetext')).toBe('125%')
    input(labelled<HTMLInputElement>(target, 'Digit weight'), '600')
    expect(settingsStore.device.fontWeight).toBe(600)
    input(labelled<HTMLInputElement>(target, 'Ring thickness'), '2')
    expect(settingsStore.device.ringScale).toBe(2)
    click(query(target, 'input[type="radio"][value="compact"]'))
    expect(settingsStore.device.density).toBe('compact')
    input(labelled<HTMLSelectElement>(target, 'Language'), 'zh-TW', 'change')
    expect(settingsStore.device.locale).toBe('zh-TW')
  })

  it('shows changes made elsewhere (another tab)', async () => {
    const { target, stores } = await setup()
    stores.device.setValue('themeMode', 'light')
    flushSync()
    expect(query<HTMLInputElement>(target, 'input[value="light"]').checked).toBe(true)
    expect(query<HTMLInputElement>(target, 'input[value="system"]').checked).toBe(false)
  })

  it('sets a seed color and puts the default back', async () => {
    const { target, settingsStore } = await setup()
    const color = labelled<HTMLInputElement>(target, 'Color')
    expect(color.value).toBe('#0b57d0')
    input(color, '#8e24aa', 'change')
    expect(settingsStore.device.seed).toBe('#8e24aa')
    click(button(target, 'Default'))
    expect(settingsStore.device.seed).toBe('')
    expect(document.activeElement).toBe(color)
  })

  it('Reset restores every appearance default', async () => {
    const { target, settingsStore } = await setup()
    settingsStore.updateDevice({ themeMode: 'dark', digitScale: 1.5, locale: 'ja' })
    flushSync()
    click(byName(target, 'Reset Appearance settings'))
    expect(settingsStore.device).toEqual(settings.DEVICE_DEFAULTS)
  })
})

describe('Behavior', () => {
  it('writes each control to the synced settings', async () => {
    const { target, settingsStore } = await setup({ section: 'behavior' })
    click(query(target, 'input[type="radio"][value="fixed"]'))
    expect(settingsStore.synced.timeStyle).toBe('fixed')
    click(query(target, 'input[type="radio"][value="h23"]'))
    expect(settingsStore.synced.hourCycle).toBe('h23')
    input(labelled<HTMLSelectElement>(target, 'Sound'), 'bell', 'change')
    expect(settingsStore.synced.sound).toBe('bell')
    // Dragging shows the value but writes it only when let go: one synced write per drag.
    const volume = labelled<HTMLInputElement>(target, 'Volume')
    input(volume, '0.5')
    expect(settingsStore.synced.volume).toBe(0.8)
    expect(volume.getAttribute('aria-valuetext')).toBe('50%')
    input(volume, '0.5', 'change')
    expect(settingsStore.synced.volume).toBe(0.5)
    const loop = labelled(target, 'Loop sound')
    expect(loop.getAttribute('role')).toBe('switch')
    click(loop)
    expect(settingsStore.synced.loop).toBe(false)
    expect(loop.getAttribute('aria-checked')).toBe('false')
    input(labelled<HTMLSelectElement>(target, 'Auto-stop'), '10', 'change')
    expect(settingsStore.synced.autoStopMinutes).toBe(10)
    click(labelled(target, 'Overtime counter'))
    expect(settingsStore.synced.showOvertime).toBe(false)
    click(labelled(target, 'Confirm before delete'))
    expect(settingsStore.synced.confirmDelete).toBe(true)
  })

  it('previews the chosen sound at the chosen volume', async () => {
    const { target, previewSound, settingsStore } = await setup({ section: 'behavior' })
    settingsStore.updateSynced({ sound: 'beep', volume: 0.4 })
    flushSync()
    click(button(target, 'Preview'))
    expect(previewSound).toHaveBeenCalledWith('beep', 0.4)
  })

  it('asks for notification permission when switched on, and says when it is blocked', async () => {
    const { target, settingsStore, notifier } = await setup({ section: 'behavior' })
    const notifications = labelled(target, 'Notifications')
    click(notifications)
    expect(settingsStore.synced.notifications).toBe(false)
    expect(notifier.request).not.toHaveBeenCalled()
    click(notifications)
    expect(settingsStore.synced.notifications).toBe(true)
    expect(notifier.request).toHaveBeenCalledTimes(1)
    await settle()
    const description = document.getElementById(
      notifications.getAttribute('aria-describedby') ?? '',
    )
    expect(description?.textContent).toBe('Notifications are blocked for this site in your browser')
  })

  it('edits the quick-add chips like a card: typed digits, committed in range', async () => {
    const { target, settingsStore } = await setup({ section: 'behavior' })
    const chip = labelled<HTMLInputElement>(target, 'Chip 2')
    expect(chip.value).toBe('1:00')
    chip.focus()
    chip.dispatchEvent(new FocusEvent('focus'))
    flushSync()
    expect(chip.value).toBe('00:01:00')
    input(chip, '9')
    expect(chip.value).toBe('00:00:09')
    input(chip, '00:00:090')
    expect(chip.value).toBe('00:00:90')
    key(chip, { key: 'Enter' })
    expect(settingsStore.synced.quickAdd).toEqual([30_000, 90_000, 300_000])
    expect(chip.value).toBe('00:01:30')
    input(chip, '')
    key(chip, { key: 'Enter' })
    expect(chip.getAttribute('aria-invalid')).toBe('true')
    expect(settingsStore.synced.quickAdd[1]).toBe(90_000)
    const escape = key(chip, { key: 'Escape' })
    expect(escape.defaultPrevented).toBe(true)
    expect(chip.value).toBe('00:01:30')
    expect(chip.getAttribute('aria-invalid')).toBeNull()
    const second = key(chip, { key: 'Escape' })
    expect(second.defaultPrevented).toBe(false)
    chip.dispatchEvent(new FocusEvent('blur'))
    flushSync()
    expect(chip.value).toBe('1:30')
  })

  it('Reset restores behavior but keeps the shortcuts', async () => {
    const { target, settingsStore } = await setup({ section: 'behavior' })
    settingsStore.updateSynced({ loop: false, volume: 0.2, keymap: { lap: ['x'] } })
    flushSync()
    click(byName(target, 'Reset Behavior settings'))
    expect(settingsStore.synced).toEqual({ ...settings.SYNCED_DEFAULTS, keymap: { lap: ['x'] } })
  })
})

describe('Keyboard', () => {
  function row(target: ParentNode, action: keymap.ActionId): HTMLElement {
    return query(target, `[data-action="${action}"]`)
  }

  it('lists every action but the mini window with its keys', async () => {
    const { target } = await setup({ section: 'keyboard' })
    const rows = target.querySelectorAll('[data-action]')
    expect(rows).toHaveLength(26)
    expect(target.querySelector('[data-action="miniWindow"]')).toBeNull()
    expect(row(target, 'palette').querySelector('kbd')?.textContent).toBe('Ctrl+K')
    expect(row(target, 'settings').querySelector('kbd')?.textContent).toBe('Ctrl+,')
    expect(row(target, 'dismiss').textContent).toContain('None')
  })

  it('shows macOS key labels on a Mac', async () => {
    const { target } = await setup({ section: 'keyboard', keyPlatform: 'mac' })
    expect(row(target, 'palette').querySelector('kbd')?.textContent).toBe('⌘K')
  })

  it('records a free key, announces it and returns focus to the edit button', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for New timer'))
    await settle()
    const recorder = byName<HTMLInputElement>(target, 'Change the shortcut for New timer')
    expect(recorder.tagName).toBe('INPUT')
    expect(document.activeElement).toBe(recorder)
    key(recorder, { key: 'Shift', shiftKey: true })
    expect(recorder.value).toBe('Shift+…')
    const event = key(recorder, { key: 'T', shiftKey: true })
    expect(event.defaultPrevented).toBe(true)
    expect(settingsStore.synced.keymap).toEqual({ newTimer: ['Shift+t'] })
    expect(settingsStore.bindings.newTimer).toEqual(['Shift+t'])
    expect(currentAnnouncement()).toBe('Shortcut for New timer set to Shift+T')
    await settle()
    expect(document.activeElement).toBe(byName(target, 'Change the shortcut for New timer'))
    expect(row(target, 'newTimer').querySelector('kbd')?.textContent).toBe('Shift+T')
  })

  it('refuses digits and keeps recording; Esc cancels without closing the dialog', async () => {
    const { target, settingsStore, state } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for Lap'))
    await settle()
    const recorder = byName<HTMLInputElement>(target, 'Change the shortcut for Lap')
    key(recorder, { key: '5' })
    expect(row(target, 'lap').querySelector('[role="alert"]')?.textContent).toBe(
      "5 can't be used as a shortcut",
    )
    expect(recorder.getAttribute('aria-invalid')).toBe('true')
    const escape = key(recorder, { key: 'Escape' })
    expect(escape.defaultPrevented).toBe(true)
    expect(state.open).toBe(true)
    expect(settingsStore.synced.keymap).toEqual({})
    await settle()
    expect(document.activeElement).toBe(byName(target, 'Change the shortcut for Lap'))
  })

  it('records the settings shortcut itself instead of closing', async () => {
    const { target, settingsStore, state } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for Lap'))
    await settle()
    key(byName(target, 'Change the shortcut for Lap'), { key: ',', ctrlKey: true })
    expect(state.open).toBe(true)
    expect(row(target, 'lap').textContent).toContain('Ctrl+, is already used for Settings')
    expect(settingsStore.synced.keymap).toEqual({})
  })

  it('asks before taking a key from another action, and moves it on request', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for New stopwatch'))
    await settle()
    key(byName(target, 'Change the shortcut for New stopwatch'), { key: 'k', ctrlKey: true })
    const question = row(target, 'newStopwatch')
    expect(question.textContent).toContain('Ctrl+K is already used for Command palette')
    await settle()
    expect(document.activeElement).toBe(button(question, 'Move here'))
    // Esc answers the question, not the dialog.
    const escape = key(query(question, '[role="group"]'), { key: 'Escape' })
    expect(escape.defaultPrevented).toBe(true)
    expect(settingsStore.synced.keymap).toEqual({})
    click(byName(target, 'Change the shortcut for New stopwatch'))
    await settle()
    key(byName(target, 'Change the shortcut for New stopwatch'), { key: 'k', ctrlKey: true })
    click(button(row(target, 'newStopwatch'), 'Move here'))
    expect(settingsStore.synced.keymap).toEqual({ newStopwatch: ['Mod+k'], palette: [] })
    expect(row(target, 'palette').textContent).toContain('None')
    expect(currentAnnouncement()).toBe('Shortcut for New stopwatch set to Ctrl+K')
  })

  it('removes a key, resets one action and resets them all', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    const reset = byName(target, 'Reset the shortcut for Fullscreen')
    expect(reset.classList.contains('unchanged')).toBe(true)
    click(byName(target, 'Remove F from Fullscreen'))
    expect(settingsStore.synced.keymap).toEqual({ fullscreen: [] })
    await settle()
    expect(document.activeElement).toBe(byName(target, 'Change the shortcut for Fullscreen'))
    expect(
      byName(target, 'Reset the shortcut for Fullscreen').classList.contains('unchanged'),
    ).toBe(false)
    click(byName(target, 'Reset the shortcut for Fullscreen'))
    expect(settingsStore.synced.keymap).toEqual({})
    settingsStore.updateSynced({ keymap: { lap: ['x'], mute: ['Mod+m'] } })
    flushSync()
    click(byName(target, 'Reset all shortcuts'))
    expect(settingsStore.synced.keymap).toEqual({})
    expect(currentAnnouncement()).toBe('Keyboard shortcuts reset')
  })

  it('names the Reset all button with its visible text', async () => {
    const { target } = await setup({ section: 'keyboard' })
    const resetAll = button(target, 'Reset all')
    expect(resetAll.getAttribute('aria-label')).toBe('Reset all shortcuts')
    expect(resetAll.getAttribute('aria-label')).toContain(resetAll.textContent.trim())
  })

  it('announces removing a key and resetting an action', async () => {
    const { target } = await setup({ section: 'keyboard' })
    click(byName(target, 'Remove F from Fullscreen'))
    expect(currentAnnouncement()).toBe('Removed F from Fullscreen')
    click(byName(target, 'Reset the shortcut for Fullscreen'))
    expect(currentAnnouncement()).toBe('Shortcut for Fullscreen reset to F')
  })

  it('records a character typed with AltGr as that character, the key that later fires', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for New timer'))
    await settle()
    const recorder = byName<HTMLInputElement>(target, 'Change the shortcut for New timer')
    // AltGr+Q on a German keyboard: Windows reports Ctrl+Alt with the AltGraph state.
    key(recorder, { key: '@', ctrlKey: true, altKey: true, modifierAltGraph: true })
    expect(settingsStore.synced.keymap).toEqual({ newTimer: ['@'] })
    expect(row(target, 'newTimer').querySelector('kbd')?.textContent).toBe('@')
  })

  it('records ? without the Shift it takes to type it', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for Rename'))
    await settle()
    key(byName(target, 'Change the shortcut for Rename'), { key: '?', shiftKey: true })
    expect(row(target, 'rename').textContent).toContain('? is already used for Keyboard shortcuts')
    expect(settingsStore.synced.keymap).toEqual({})
  })

  it('takes a key only the hidden mini window has, without asking', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    click(byName(target, 'Change the shortcut for New timer'))
    await settle()
    key(byName(target, 'Change the shortcut for New timer'), { key: 't' })
    expect(settingsStore.synced.keymap).toEqual({ newTimer: ['t'], miniWindow: [] })
  })

  it('flags keys that several actions have, as an import can leave them', async () => {
    const { target, settingsStore } = await setup({ section: 'keyboard' })
    expect(target.querySelector('.shared')).toBeNull()
    settingsStore.updateSynced({ keymap: { newTimer: ['Mod+K'] } })
    flushSync()
    expect(row(target, 'newTimer').querySelector('.shared')?.textContent).toContain(
      'Ctrl+K is also used for Command palette',
    )
    expect(row(target, 'palette').querySelector('.shared')?.textContent).toContain(
      'Ctrl+K is also used for New timer',
    )
    const change = byName(target, 'Change the shortcut for New timer')
    const note = document.getElementById(change.getAttribute('aria-describedby') ?? '')
    expect(note?.textContent).toContain('also used for Command palette')
    // Moving the key away clears both rows.
    click(byName(target, 'Reset the shortcut for New timer'))
    expect(target.querySelector('.shared')).toBeNull()
  })
})

describe('Presets', () => {
  const names = (store: { presets: readonly { name: string }[] }) =>
    store.presets.map((p) => p.name)

  it('adds a preset and focuses its name, ready to type', async () => {
    const { target, presetStore } = await setup({ section: 'presets' })
    click(button(target, 'Add preset'))
    expect(names(presetStore)).toEqual(['Tea', 'Pomodoro', 'Break', 'Eggs', 'New preset'])
    expect(presetStore.presets.at(-1)?.duration).toBe(300_000)
    await settle()
    const focused = document.activeElement as HTMLInputElement
    expect(focused.getAttribute('aria-label')).toBe('Preset name')
    expect(focused.value).toBe('New preset')
  })

  it('renames on change and puts a blank or abandoned name back', async () => {
    const { target, presetStore } = await setup({ section: 'presets' })
    const field = () => target.querySelectorAll<HTMLInputElement>('[aria-label="Preset name"]')[0]
    const tea = field()
    if (tea === undefined) throw new Error('no name field')
    input(tea, 'Green tea')
    input(tea, 'Green tea', 'change')
    expect(names(presetStore)[0]).toBe('Green tea')
    input(tea, '   ')
    input(tea, '   ', 'change')
    expect(names(presetStore)[0]).toBe('Green tea')
    expect(field()?.value).toBe('Green tea')
    input(tea, 'Oolong')
    const escape = key(tea, { key: 'Escape' })
    expect(escape.defaultPrevented).toBe(true)
    expect(field()?.value).toBe('Green tea')
    input(tea, 'Oolong')
    key(tea, { key: 'Enter' })
    expect(names(presetStore)[0]).toBe('Oolong')
  })

  it('changes a duration typed as digits', async () => {
    const { target, presetStore } = await setup({ section: 'presets' })
    const duration = byName<HTMLInputElement>(target, 'Duration of Eggs')
    expect(duration.value).toBe('7:00')
    duration.dispatchEvent(new FocusEvent('focus'))
    flushSync()
    input(duration, '630')
    duration.dispatchEvent(new FocusEvent('blur'))
    flushSync()
    expect(presetStore.presets.at(-1)?.duration).toBe(390_000)
    expect(byName<HTMLInputElement>(target, 'Duration of Eggs').value).toBe('6:30')
  })

  it('keeps a duration committed with Enter when the field is left afterwards', async () => {
    const { target, presetStore } = await setup({ section: 'presets' })
    const duration = byName<HTMLInputElement>(target, 'Duration of Eggs')
    duration.dispatchEvent(new FocusEvent('focus'))
    flushSync()
    input(duration, '90')
    key(duration, { key: 'Enter' })
    expect(presetStore.presets.at(-1)?.duration).toBe(90_000)
    expect(duration.value).toBe('00:01:30')
    duration.dispatchEvent(new FocusEvent('blur'))
    flushSync()
    expect(presetStore.presets.at(-1)?.duration).toBe(90_000)
    expect(byName<HTMLInputElement>(target, 'Duration of Eggs').value).toBe('1:30')
  })

  it('moves presets, keeping focus on the moved row, and announces it', async () => {
    const { target, presetStore } = await setup({ section: 'presets' })
    expect(byName<HTMLButtonElement>(target, 'Move Tea up').disabled).toBe(true)
    expect(byName<HTMLButtonElement>(target, 'Move Eggs down').disabled).toBe(true)
    click(byName(target, 'Move Break up'))
    expect(names(presetStore)).toEqual(['Tea', 'Break', 'Pomodoro', 'Eggs'])
    expect(currentAnnouncement()).toBe('Moved Break to position 2 of 4')
    await settle()
    expect(document.activeElement).toBe(byName(target, 'Move Break up'))
    click(byName(target, 'Move Break up'))
    await settle()
    // At the top, Move up is disabled: focus goes to Move down.
    expect(document.activeElement).toBe(byName(target, 'Move Break down'))
  })

  it('deletes presets, moving focus on, and says when there are none', async () => {
    const { target, presetStore } = await setup({ section: 'presets' })
    click(byName(target, 'Delete Pomodoro'))
    expect(names(presetStore)).toEqual(['Tea', 'Break', 'Eggs'])
    expect(currentAnnouncement()).toBe('Deleted Pomodoro')
    await settle()
    expect(document.activeElement).toBe(byName(target, 'Delete Break'))
    for (const name of ['Tea', 'Break', 'Eggs']) click(byName(target, `Delete ${name}`))
    expect(target.textContent).toContain('No presets yet')
    await settle()
    expect(document.activeElement).toBe(button(target, 'Add preset'))
  })
})

describe('Data', () => {
  function pick(target: ParentNode, file: File) {
    const picker = query<HTMLInputElement>(target, 'input[type="file"]')
    Object.defineProperty(picker, 'files', { value: [file], configurable: true })
    picker.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function exportFile(presets: readonly exportFormat.ExportPreset[]) {
    const data = exportFormat.createExport({
      exportedAt: Date.UTC(2026, 9, 18),
      cards: [],
      presets,
      settings: { synced: settings.SYNCED_DEFAULTS, device: settings.DEVICE_DEFAULTS },
    })
    return { data, file: new File([exportFormat.stringifyExport(data)], 'timer-app.json') }
  }

  it('exports through the app', async () => {
    const { target, onexport } = await setup({ section: 'data' })
    click(button(target, 'Export'))
    expect(onexport).toHaveBeenCalledTimes(1)
  })

  it('says why a file cannot be imported', async () => {
    const { target, onimport } = await setup({ section: 'data' })
    pick(target, new File(['{nope'], 'bad.json'))
    await vi.waitFor(() => {
      flushSync()
      expect(query(target, '[role="alert"]').textContent).toContain("The file isn't valid JSON.")
    })
    expect(query(target, '[role="alert"]').textContent).toContain("Can't import this file")
    expect(onimport).not.toHaveBeenCalled()
  })

  it('asks before replacing everything, then hands the data to the app', async () => {
    const { target, onimport } = await setup({ section: 'data' })
    const { data, file } = exportFile([{ id: 'x', name: 'Imported', duration: 60_000 }])
    pick(target, file)
    let question: HTMLDialogElement | undefined
    await vi.waitFor(() => {
      flushSync()
      question = [...target.querySelectorAll<HTMLDialogElement>('dialog dialog')].find(
        (d) => d.open,
      )
      expect(question).toBeDefined()
    })
    expect(question?.textContent).toContain(
      'Replace your 2 cards and 4 presets with 0 cards and 1 preset from this file?',
    )
    click(button(question, 'Cancel'))
    expect(question?.open).toBe(false)
    expect(onimport).not.toHaveBeenCalled()

    pick(target, file)
    await vi.waitFor(() => {
      flushSync()
      expect(question?.open).toBe(true)
    })
    click(button(question, 'Replace'))
    expect(onimport).toHaveBeenCalledWith(data)
    expect(query(target, '[role="status"].result').textContent).toBe(
      'Imported 0 cards and 1 preset',
    )
  })
})

describe('About', () => {
  it('shows the version, the platform, the source and the license', async () => {
    const { target } = await setup({ section: 'about' })
    const text = target.textContent
    expect(text).toContain('Timer App')
    expect(text).toContain('Version 1.2.3')
    expect(text).toContain('Web')
    expect(text).toContain('Released under the MIT License')
    const link = query<HTMLAnchorElement>(target, 'a[href]')
    expect(link.href).toBe('https://github.com/hotdogee/timer-app')
    expect(link.rel).toBe('noopener noreferrer')
  })
})
