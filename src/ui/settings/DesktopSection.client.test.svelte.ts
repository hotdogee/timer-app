/**
 * Settings › Desktop against real stores (in-memory TinyBase) and fake desktop services, in jsdom
 * with Svelte's browser runtime: launch at login follows the OS, close behavior and on-top write
 * their settings, global hotkeys are recorded, registered and saved only once the OS takes them
 * (and one the OS refused at launch shows that at once, and is tried again), and Reset undoes
 * everything. Also: the section exists only in the desktop app.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { settings } from '../../core'
import { setAppLocale } from '../../i18n'
import type { HotkeyResult, PlatformKind } from '../../platform'
import { bindHotkey, hotkeyStatus } from '../../state/hotkey-status.svelte'
import { BUILTIN_PRESETS } from '../../state/presets'
import { createPresetStore } from '../../state/presets.svelte'
import { createSettingsStore } from '../../state/settings.svelte'
import { createAppStores } from '../../sync/stores'
import { createFakeAuth } from '../account/fake-auth.svelte'
import { currentAnnouncement } from '../announce.svelte'
import DesktopSection from './DesktopSection.svelte'
import type { SectionId } from './sections'
import SettingsDialog from './SettingsDialog.svelte'

beforeAll(() => {
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
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  setAppLocale('en')
  hotkeyStatus.toggleLast = null
  hotkeyStatus.showApp = null
})

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick()
    await Promise.resolve()
  }
  flushSync()
}

/** Fake desktop services: the OS state, and what each call did. */
function fakeServices(
  options: { enabled?: boolean | null; refuse?: boolean; taken?: string[] } = {},
) {
  // null: the OS cannot say.
  let enabled = options.enabled === undefined ? false : options.enabled
  const taken = new Set(options.taken ?? [])
  // What the OS has registered, by hotkey (read by the tests, never reactively).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const registered = new Map<string, string>()
  return {
    registered,
    taken,
    autostart: {
      supported: true,
      isEnabled: vi.fn(() => Promise.resolve(enabled)),
      setEnabled: vi.fn((on: boolean) => {
        if (options.refuse !== true) enabled = on
        return Promise.resolve(enabled === true)
      }),
    },
    hotkeys: {
      supported: true,
      set: vi.fn((id: settings.HotkeyId, combo: string | null): Promise<HotkeyResult> => {
        registered.delete(id)
        if (combo === null) return Promise.resolve('ok')
        if (taken.has(combo)) return Promise.resolve('taken')
        registered.set(id, combo)
        return Promise.resolve('ok')
      }),
      onPressed: () => () => undefined,
    },
    windows: {
      supported: true,
      isOpen: () => true,
      open: () => Promise.resolve(),
      close: () => Promise.resolve(),
      setAlwaysOnTop: vi.fn(() => Promise.resolve()),
      onChange: () => () => undefined,
    },
  }
}

async function setup(
  options: Parameters<typeof fakeServices>[0] = {},
  before?: (
    settingsStore: ReturnType<typeof createSettingsStore>,
    services: ReturnType<typeof fakeServices>,
  ) => Promise<void>,
) {
  const settingsStore = createSettingsStore(createAppStores())
  const services = fakeServices(options)
  await before?.(settingsStore, services)
  const target = document.createElement('div')
  document.body.append(target)
  const section = mount(DesktopSection, {
    target,
    props: { settingsStore, platform: 'other', services },
  })
  cleanups.push(() => {
    void unmount(section)
    target.remove()
  })
  await settle()
  return { settingsStore, services, target }
}

function labelled<T extends HTMLElement = HTMLElement>(root: ParentNode, text: string): T {
  const label = [...root.querySelectorAll('label')].find((l) => l.textContent.trim() === text)
  const control = label === undefined ? null : document.getElementById(label.htmlFor)
  if (control === null) throw new Error(`No control labelled ${text}`)
  return control as T
}

function row(root: ParentNode, id: settings.HotkeyId): HTMLElement {
  const found = root.querySelector<HTMLElement>(`[data-hotkey="${id}"]`)
  if (found === null) throw new Error(`No row ${id}`)
  return found
}

function text(root: Element): string {
  return root.textContent.replace(/\s+/g, ' ').trim()
}

/** Opens the recorder of hotkey `id` and presses a key in it. */
async function record(
  root: ParentNode,
  id: settings.HotkeyId,
  key: string,
  mods: KeyboardEventInit = {},
) {
  row(root, id).querySelector<HTMLButtonElement>('[data-part="change"]')?.click()
  await settle()
  const field = row(root, id).querySelector('input')
  if (field === null) throw new Error('No recorder')
  field.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }),
  )
  await settle()
}

describe('launch at login', () => {
  it('follows the OS when the section opens', async () => {
    const { settingsStore, target } = await setup({ enabled: true })
    expect(settingsStore.desktop.launchAtLogin).toBe(true)
    expect(labelled(target, 'Launch at login').getAttribute('aria-checked')).toBe('true')
  })

  it('turns it on through the OS', async () => {
    const { settingsStore, services, target } = await setup()
    labelled(target, 'Launch at login').click()
    await settle()
    expect(services.autostart.setEnabled).toHaveBeenCalledWith(true)
    expect(settingsStore.desktop.launchAtLogin).toBe(true)
  })

  it('springs back and says so when the OS refuses, out loud too', async () => {
    const { settingsStore, target } = await setup({ refuse: true })
    const control = labelled(target, 'Launch at login')
    control.click()
    await settle()
    expect(settingsStore.desktop.launchAtLogin).toBe(false)
    expect(control.getAttribute('aria-checked')).toBe('false')
    expect(text(target)).toContain("Couldn't change this setting.")
    expect(currentAnnouncement()).toContain("Couldn't change this setting.")
  })

  it('springs back on when the OS refuses to turn it off', async () => {
    const { settingsStore, target } = await setup({ enabled: true, refuse: true })
    expect(settingsStore.desktop.launchAtLogin).toBe(true)
    const control = labelled(target, 'Launch at login')
    control.click()
    await settle()
    expect(settingsStore.desktop.launchAtLogin).toBe(true)
    expect(control.getAttribute('aria-checked')).toBe('true')
    expect(text(target)).toContain("Couldn't change this setting.")
  })

  it('keeps the setting when the OS cannot say, and is unavailable once the service is off', async () => {
    const { settingsStore, services, target } = await setup({ enabled: null }, (store) => {
      store.updateDesktop({ launchAtLogin: true })
      return Promise.resolve()
    })
    expect(services.autostart.isEnabled).toHaveBeenCalled()
    expect(settingsStore.desktop.launchAtLogin).toBe(true)
    expect(labelled(target, 'Launch at login').hasAttribute('disabled')).toBe(false)

    const off = await setup({}, (_store, fake) => {
      fake.autostart.supported = false
      return Promise.resolve()
    })
    expect(labelled(off.target, 'Launch at login').hasAttribute('disabled')).toBe(true)
  })
})

describe('closing and the mini window', () => {
  it('writes the close behavior', async () => {
    const { settingsStore, target } = await setup()
    const select = labelled<HTMLSelectElement>(target, 'Closing the window')
    expect([...select.options].map((o) => o.textContent.trim())).toEqual([
      'Hide to the tray while a timer runs',
      'Always hide to the tray',
      'Quit',
    ])
    select.value = 'quit'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(settingsStore.desktop.closeBehavior).toBe('quit')
  })

  it('keeps the mini window on top or not, at once', async () => {
    const { settingsStore, services, target } = await setup()
    labelled(target, 'Mini window stays on top').click()
    await settle()
    expect(settingsStore.desktop.miniAlwaysOnTop).toBe(false)
    expect(services.windows.setAlwaysOnTop).toHaveBeenCalledWith(false)
  })
})

describe('global hotkeys', () => {
  it('are unbound at first', async () => {
    const { target } = await setup()
    expect(text(row(target, 'toggleLast'))).toContain('Start or pause the last card None')
    expect(text(row(target, 'showApp'))).toContain('Show or hide Timer App None')
  })

  it('records a combo, registers it and saves it', async () => {
    const { settingsStore, services, target } = await setup()
    await record(target, 'toggleLast', ' ', { ctrlKey: true, shiftKey: true })
    expect(services.hotkeys.set).toHaveBeenCalledWith('toggleLast', 'Mod+Shift+Space')
    expect(settingsStore.desktop.hotkeys.toggleLast).toBe('Mod+Shift+Space')
    expect(services.registered.get('toggleLast')).toBe('Mod+Shift+Space')
    expect(text(row(target, 'toggleLast'))).toContain('Ctrl+Shift+Space')
    expect(currentAnnouncement()).toBe(
      'Global shortcut for Start or pause the last card set to Ctrl+Shift+Space',
    )
  })

  it('releases every hotkey while recording, and binds them again after', async () => {
    const { settingsStore, services, target } = await setup()
    settingsStore.updateDesktop({ hotkeys: { showApp: 'Mod+Alt+t' } })
    await settle()
    row(target, 'toggleLast').querySelector<HTMLButtonElement>('[data-part="change"]')?.click()
    await settle()
    expect(services.hotkeys.set).toHaveBeenCalledWith('toggleLast', null)
    expect(services.hotkeys.set).toHaveBeenCalledWith('showApp', null)
    expect(services.registered.size).toBe(0)
    const field = row(target, 'toggleLast').querySelector('input')
    field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(services.registered.get('showApp')).toBe('Mod+Alt+t')
    expect(services.registered.has('toggleLast')).toBe(false)
  })

  it('refuses keys without Ctrl, Alt or Meta, and the other hotkey’s combo', async () => {
    const { settingsStore, target } = await setup()
    await record(target, 'showApp', 't', { shiftKey: true })
    expect(text(row(target, 'showApp'))).toContain('Global shortcuts need Ctrl, Alt or Meta')
    settingsStore.updateDesktop({ hotkeys: { toggleLast: 'Mod+Shift+Space' } })
    await settle()
    const field = row(target, 'showApp').querySelector('input')
    field?.dispatchEvent(
      new KeyboardEvent('keydown', { key: ' ', ctrlKey: true, shiftKey: true, bubbles: true }),
    )
    await settle()
    expect(text(row(target, 'showApp'))).toContain(
      'Ctrl+Shift+Space is already used for Start or pause the last card',
    )
    expect(settingsStore.desktop.hotkeys.showApp).toBeNull()
  })

  it('keeps the previous combo when another app has the new one', async () => {
    const { settingsStore, services, target } = await setup({ taken: ['Mod+Shift+k'] })
    settingsStore.updateDesktop({ hotkeys: { showApp: 'Mod+Alt+t' } })
    await settle()
    await record(target, 'showApp', 'K', { ctrlKey: true, shiftKey: true })
    expect(settingsStore.desktop.hotkeys.showApp).toBe('Mod+Alt+t')
    expect(services.registered.get('showApp')).toBe('Mod+Alt+t')
    expect(text(row(target, 'showApp'))).toContain('Another app uses Ctrl+Shift+K')
    expect(row(target, 'showApp').querySelector('[role="alert"]')?.textContent).toBe(
      'Another app uses Ctrl+Shift+K',
    )
  })

  it('shows at once that a hotkey failed at launch, and binds it once the other app lets go', async () => {
    const { settingsStore, services, target } = await setup(
      { taken: ['Mod+Alt+l'] },
      async (store, fake) => {
        // As at launch (`startDesktop`): the stored combo, which another app held then.
        store.updateDesktop({ hotkeys: { toggleLast: 'Mod+Alt+l' } })
        await bindHotkey(fake.hotkeys, 'toggleLast', 'Mod+Alt+l')
        expect(hotkeyStatus.toggleLast).toEqual({ combo: 'Mod+Alt+l', result: 'taken' })
      },
    )
    // Tried again on opening; still taken, so the row says so.
    expect(services.hotkeys.set).toHaveBeenCalledTimes(2)
    expect(row(target, 'toggleLast').querySelector('[role="alert"]')?.textContent).toBe(
      'Another app uses Ctrl+Alt+L',
    )
    expect(settingsStore.desktop.hotkeys.toggleLast).toBe('Mod+Alt+l')

    // The other app quits; opening the section again binds it, and the error goes.
    services.taken.clear()
    const again = await setup({}, (store) => {
      store.updateDesktop({ hotkeys: { toggleLast: 'Mod+Alt+l' } })
      return Promise.resolve()
    })
    expect(again.services.registered.get('toggleLast')).toBe('Mod+Alt+l')
    expect(row(again.target, 'toggleLast').querySelector('[role="alert"]')?.textContent).toBe('')
    expect(hotkeyStatus.toggleLast).toEqual({ combo: 'Mod+Alt+l', result: 'ok' })
  })

  it('shows a launch failure other than taken without trying again', async () => {
    const { services, target } = await setup({}, (store) => {
      store.updateDesktop({ hotkeys: { showApp: 'Mod+Alt+F24' } })
      hotkeyStatus.showApp = { combo: 'Mod+Alt+F24', result: 'invalid' }
      return Promise.resolve()
    })
    expect(services.hotkeys.set).not.toHaveBeenCalled()
    expect(row(target, 'showApp').querySelector('[role="alert"]')?.textContent).toBe(
      "Ctrl+Alt+F24 can't be used as a global shortcut",
    )
  })

  it('removes a combo', async () => {
    const { settingsStore, services, target } = await setup()
    settingsStore.updateDesktop({ hotkeys: { showApp: 'Mod+Alt+t' } })
    await settle()
    row(target, 'showApp').querySelector<HTMLButtonElement>('.remove')?.click()
    await settle()
    expect(services.hotkeys.set).toHaveBeenLastCalledWith('showApp', null)
    expect(settingsStore.desktop.hotkeys.showApp).toBeNull()
    expect(currentAnnouncement()).toBe('Global shortcut for Show or hide Timer App removed')
  })
})

describe('reset', () => {
  it('restores the defaults, in the OS too', async () => {
    const { settingsStore, services, target } = await setup({ enabled: true })
    settingsStore.updateDesktop({
      closeBehavior: 'quit',
      miniAlwaysOnTop: false,
      hotkeys: { toggleLast: 'Mod+Shift+Space' },
    })
    await settle()
    const reset = [...target.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === 'Reset Desktop settings',
    )
    reset?.click()
    await settle()
    expect(settingsStore.desktop).toEqual(settings.DESKTOP_DEFAULTS)
    expect(services.autostart.setEnabled).toHaveBeenCalledWith(false)
    expect(services.hotkeys.set).toHaveBeenCalledWith('toggleLast', null)
    expect(services.windows.setAlwaysOnTop).toHaveBeenCalledWith(true)
    expect(currentAnnouncement()).toBe('Desktop settings reset')
  })
})

describe('in the settings dialog', () => {
  async function dialog(platformKind: PlatformKind, section: SectionId) {
    const stores = createAppStores()
    const settingsStore = createSettingsStore(stores)
    const presetStore = createPresetStore(stores.synced, { newId: () => 'p' })
    for (const preset of BUILTIN_PRESETS) presetStore.add(preset.name, preset.duration)
    const state = $state({ open: true, section })
    const target = document.createElement('div')
    document.body.append(target)
    const view = mount(SettingsDialog, {
      target,
      props: {
        get open() {
          return state.open
        },
        set open(value) {
          state.open = value
        },
        get section() {
          return state.section
        },
        set section(value) {
          state.section = value
        },
        settingsStore,
        presetStore,
        cardCount: 1,
        onexport: () => undefined,
        onimport: () => undefined,
        platformKind,
        auth: createFakeAuth().auth,
        sync: null,
        syncPreference: null,
        desktopServices: fakeServices(),
      },
    })
    cleanups.push(() => {
      void unmount(view)
      target.remove()
    })
    await settle()
    const tabs = [...target.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim())
    return { target, tabs, state }
  }

  it('lists Desktop between Keyboard and Presets in the desktop app', async () => {
    const { tabs, target } = await dialog('tauri', 'desktop')
    expect(tabs).toEqual([
      'Appearance',
      'Behavior',
      'Keyboard',
      'Desktop',
      'Presets',
      'Data',
      'Account',
      'About',
    ])
    expect(target.querySelector('[data-hotkey="toggleLast"]')).not.toBeNull()
  })

  it('has no Desktop section on the web', async () => {
    const { tabs, target, state } = await dialog('web', 'desktop')
    expect(tabs).not.toContain('Desktop')
    expect(state.section).toBe('appearance')
    expect(target.querySelector('[data-hotkey]')).toBeNull()
  })
})
