/**
 * The desktop services against a fake shell: `@tauri-apps/api/mocks` routes every command the
 * real modules invoke (plugins included) to {@link fakeShell}, which records it and answers, and
 * plays the shell's events and the plugins' channel messages back to the page.
 */
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { notificationId } from './notifications'
import { createTauriServices, type TauriServices } from './services'

type Payload = Record<string, unknown>
type Answer = (payload: Payload) => unknown

interface Listener {
  readonly event: string
  readonly target: unknown
  readonly handler: number
  readonly id: number
}

interface Internals {
  runCallback(id: number, data: unknown): void
}

/** A channel as the plugins pass it in a payload (`handler`, `onEvent`). */
interface ChannelLike {
  readonly onmessage: (message: unknown) => void
}

/**
 * A shell whose commands answer from `answers` (an unknown command rejects as Tauri's does, with
 * a string). Events are real `plugin:event|listen` registrations, recorded with their targets.
 */
function fakeShell(answers: Record<string, Answer> = {}) {
  const calls: [string, Payload][] = []
  const listeners: Listener[] = []
  let nextId = 1
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Payload
    if (cmd === 'plugin:event|listen') {
      const listener: Listener = {
        event: payload.event as string,
        target: payload.target,
        handler: payload.handler as number,
        id: nextId++,
      }
      listeners.push(listener)
      calls.push([cmd, { event: listener.event, target: listener.target }])
      return listener.id
    }
    if (cmd === 'plugin:event|unlisten') {
      const index = listeners.findIndex((listener) => listener.id === payload.eventId)
      if (index !== -1) listeners.splice(index, 1)
      calls.push([cmd, { event: payload.event }])
      return null
    }
    calls.push([cmd, payload])
    const answer = answers[cmd]
    if (answer === undefined) return refuse(`Command ${cmd} not found`)
    return answer(payload)
  })
  const internals = (window as unknown as { __TAURI_INTERNALS__: Internals }).__TAURI_INTERNALS__
  return {
    calls,
    listeners,
    /** The commands invoked so far, in order (event registrations included). */
    commands: () => calls.map(([cmd]) => cmd),
    /** The payloads `cmd` was invoked with. */
    payloads: (cmd: string) => calls.filter(([name]) => name === cmd).map(([, payload]) => payload),
    /** Sends `event` to every listener of it, whatever its target, as `app.emit` does. */
    emit(event: string, payload: unknown) {
      for (const listener of listeners.filter((l) => l.event === event)) {
        internals.runCallback(listener.handler, { event, id: listener.id, payload })
      }
    },
  }
}

const ok = (): null => null

/** A command failing as Tauri's do: rejecting with its message, a string. */
function refuse(message: string): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- as Tauri does
  return Promise.reject(message)
}

let warn: MockInstance<typeof console.warn>
let services: TauriServices

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  mockWindows('main')
  services = createTauriServices()
})

afterEach(() => {
  clearMocks()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createTauriServices', () => {
  it('touches nothing until a service is used, and every service is supported', () => {
    const shell = fakeShell()
    const fresh = createTauriServices()
    for (const service of [
      fresh.windows,
      fresh.hotkeys,
      fresh.autostart,
      fresh.updater,
      fresh.activity,
      fresh.opener,
      fresh.notifications,
      fresh.shell,
    ]) {
      expect(service.supported).toBe(true)
    }
    expect(fresh.windows.isOpen()).toBe(false)
    expect(shell.calls).toEqual([])
  })
})

describe('accent', () => {
  it('asks the shell for the accent color and normalizes it', async () => {
    let answer: unknown = '#0B57D0'
    const shell = fakeShell({ accent_color: () => answer })
    await expect(services.accent.get()).resolves.toBe('#0b57d0')
    answer = null
    await expect(services.accent.get()).resolves.toBeNull()
    answer = 'blue'
    await expect(services.accent.get()).resolves.toBeNull()
    expect(shell.calls).toEqual([
      ['accent_color', {}],
      ['accent_color', {}],
      ['accent_color', {}],
    ])
  })

  it('reports each new accent from accent-changed, ignoring payloads that are not colors', async () => {
    const shell = fakeShell()
    const seen: string[] = []
    const stop = services.accent.onChange?.((accent) => seen.push(accent))
    await vi.waitFor(() => {
      expect(shell.listeners.map((l) => l.event)).toEqual(['accent-changed'])
    })
    expect(shell.listeners[0]?.target).toEqual({ kind: 'Any' })
    shell.emit('accent-changed', '#FF0000')
    shell.emit('accent-changed', 42)
    shell.emit('accent-changed', '#00ff00')
    expect(seen).toEqual(['#ff0000', '#00ff00'])
    stop?.()
    await vi.waitFor(() => {
      expect(shell.listeners).toEqual([])
    })
    expect(shell.commands()).toContain('plugin:event|unlisten')
  })

  it('listens once for every subscriber and stops when the last one leaves', async () => {
    const shell = fakeShell()
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = services.accent.onChange?.(first)
    const stopSecond = services.accent.onChange?.(second)
    await vi.waitFor(() => {
      expect(shell.listeners).toHaveLength(1)
    })
    shell.emit('accent-changed', '#123456')
    expect(first).toHaveBeenCalledWith('#123456')
    expect(second).toHaveBeenCalledWith('#123456')
    stopFirst?.()
    stopFirst?.()
    shell.emit('accent-changed', '#654321')
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledTimes(2)
    expect(shell.listeners).toHaveLength(1)
    stopSecond?.()
    await vi.waitFor(() => {
      expect(shell.listeners).toEqual([])
    })
  })

  it('turns itself off with one warning when the shell fails', async () => {
    const shell = fakeShell({ accent_color: () => refuse('accent_color not allowed') })
    await expect(services.accent.get()).resolves.toBeNull()
    await expect(services.accent.get()).resolves.toBeNull()
    expect(shell.payloads('accent_color')).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('activity', () => {
  it('reports the running state and the close behavior, each change once', async () => {
    const shell = fakeShell({ set_running: ok, set_close_behavior: ok })
    services.activity.setRunning(true)
    services.activity.setCloseBehavior('quit')
    await vi.waitFor(() => {
      expect(shell.calls).toHaveLength(2)
    })
    services.activity.setRunning(true)
    services.activity.setCloseBehavior('quit')
    services.activity.setRunning(false)
    await vi.waitFor(() => {
      expect(shell.calls).toHaveLength(3)
    })
    expect(shell.calls).toEqual([
      ['set_running', { running: true }],
      ['set_close_behavior', { behavior: 'quit' }],
      ['set_running', { running: false }],
    ])
  })

  it('sends only the last of the changes made while a report is under way', async () => {
    let release = (): void => undefined
    const shell = fakeShell({
      set_running: () =>
        new Promise((resolve) => {
          release = () => {
            resolve(null)
          }
        }),
    })
    services.activity.setRunning(true)
    await vi.waitFor(() => {
      expect(shell.calls).toHaveLength(1)
    })
    services.activity.setRunning(false)
    services.activity.setRunning(true)
    services.activity.setRunning(false)
    release()
    await vi.waitFor(() => {
      expect(shell.calls).toHaveLength(2)
    })
    release()
    expect(shell.payloads('set_running')).toEqual([{ running: true }, { running: false }])
  })

  it('stops reporting, with one warning, once the shell refuses', async () => {
    const shell = fakeShell({ set_running: () => refuse('set_running not allowed') })
    services.activity.setRunning(true)
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledOnce()
    })
    services.activity.setRunning(false)
    services.activity.setCloseBehavior('tray')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(shell.calls).toEqual([['set_running', { running: true }]])
    expect(warn).toHaveBeenCalledOnce()
    expect(services.activity.supported).toBe(false)
  })

  it('hears the tray menu’s "Start or pause the last card" in the main window', async () => {
    const shell = fakeShell()
    const toggle = vi.fn()
    const stop = services.activity.onToggleLast(toggle)
    await vi.waitFor(() => {
      expect(shell.listeners).toHaveLength(1)
    })
    expect(shell.listeners[0]).toMatchObject({
      event: 'tray-toggle-last',
      target: { kind: 'WebviewWindow', label: 'main' },
    })
    shell.emit('tray-toggle-last', null)
    expect(toggle).toHaveBeenCalledOnce()
    stop()
    await vi.waitFor(() => {
      expect(shell.listeners).toEqual([])
    })
  })

  it('does not listen to the tray in the mini window', async () => {
    mockWindows('mini')
    const shell = fakeShell()
    const toggle = vi.fn()
    createTauriServices().activity.onToggleLast(toggle)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(shell.listeners).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })
})

/** The global-shortcut plugin, holding each registered combo's channel. */
function shortcutShell(registerAnswer: (shortcut: string) => unknown = ok) {
  const channels = new Map<string, ChannelLike>()
  let visible = true
  let focused = true
  const shell = fakeShell({
    'plugin:global-shortcut|unregister_all': ok,
    'plugin:global-shortcut|unregister': ok,
    'plugin:global-shortcut|register': (payload) => {
      const [shortcut] = payload.shortcuts as [string]
      const answer = registerAnswer(shortcut)
      if (answer instanceof Promise) return answer
      channels.set(shortcut, payload.handler as ChannelLike)
      return answer
    },
    'plugin:window|is_visible': () => visible,
    'plugin:window|is_focused': () => focused,
    'plugin:window|is_minimized': () => false,
    'plugin:window|hide': ok,
    'plugin:window|show': ok,
    'plugin:window|unminimize': ok,
    'plugin:window|set_focus': ok,
  })
  return {
    ...shell,
    channels,
    window(state: { visible: boolean; focused: boolean }) {
      visible = state.visible
      focused = state.focused
    },
    press(shortcut: string, state: 'Pressed' | 'Released' = 'Pressed') {
      channels.get(shortcut)?.onmessage({ shortcut, id: 1, state })
    },
  }
}

describe('hotkeys', () => {
  it('registers the plugin’s accelerator and reports key presses, not releases', async () => {
    const shell = shortcutShell()
    const pressed = vi.fn()
    services.hotkeys.onPressed(pressed)
    await expect(services.hotkeys.set('toggleLast', 'Mod+Shift+Space')).resolves.toBe('ok')
    expect(shell.commands()).toEqual([
      'plugin:global-shortcut|unregister_all',
      'plugin:global-shortcut|register',
    ])
    expect(shell.payloads('plugin:global-shortcut|register')[0]?.shortcuts).toEqual([
      'CommandOrControl+Shift+Space',
    ])
    shell.press('CommandOrControl+Shift+Space')
    shell.press('CommandOrControl+Shift+Space', 'Released')
    await vi.waitFor(() => {
      expect(pressed).toHaveBeenCalledOnce()
    })
    expect(pressed).toHaveBeenCalledWith('toggleLast')
  })

  it('releases the previous combo first, and only releases for null', async () => {
    const shell = shortcutShell()
    const pressed = vi.fn()
    services.hotkeys.onPressed(pressed)
    await services.hotkeys.set('toggleLast', 'Mod+Shift+Space')
    await expect(services.hotkeys.set('toggleLast', 'Alt+F9')).resolves.toBe('ok')
    await expect(services.hotkeys.set('toggleLast', null)).resolves.toBe('ok')
    expect(shell.calls.slice(2)).toEqual([
      ['plugin:global-shortcut|unregister', { shortcuts: ['CommandOrControl+Shift+Space'] }],
      ['plugin:global-shortcut|register', expect.objectContaining({ shortcuts: ['Alt+F9'] })],
      ['plugin:global-shortcut|unregister', { shortcuts: ['Alt+F9'] }],
    ])
    // A released combo whose press still arrives does nothing.
    shell.press('Alt+F9')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pressed).not.toHaveBeenCalled()
    // Earlier registrations are cleared once per page, not on every change.
    expect(shell.payloads('plugin:global-shortcut|unregister_all')).toHaveLength(1)
  })

  it('answers taken when another app holds the combo, leaving the hotkey unbound', async () => {
    const shell = shortcutShell(() =>
      refuse('HotKey already registered: HotKey { mods: Modifiers(CONTROL), key: KeyK }'),
    )
    await expect(services.hotkeys.set('showApp', 'Ctrl+K')).resolves.toBe('taken')
    await expect(services.hotkeys.set('showApp', null)).resolves.toBe('ok')
    expect(shell.commands()).not.toContain('plugin:global-shortcut|unregister')
    expect(warn).not.toHaveBeenCalled()
  })

  it('answers taken when the other hotkey holds the same combo', async () => {
    const shell = shortcutShell()
    await services.hotkeys.set('toggleLast', 'Ctrl+Alt+T')
    await expect(services.hotkeys.set('showApp', 'ctrl+alt+t')).resolves.toBe('taken')
    expect(shell.payloads('plugin:global-shortcut|register')).toHaveLength(1)
  })

  it('answers invalid for a combo with no global equivalent, without asking the OS', async () => {
    const shell = shortcutShell()
    for (const combo of ['Shift+A', 'Ctrl+?', 'Ctrl+ContextMenu', 'not a combo']) {
      await expect(services.hotkeys.set('toggleLast', combo), combo).resolves.toBe('invalid')
    }
    expect(shell.commands()).not.toContain('plugin:global-shortcut|register')
  })

  it('answers invalid when the OS has no such key', async () => {
    shortcutShell(() => refuse('Unable to register hotkey: Unknown VKCode for F24'))
    await expect(services.hotkeys.set('toggleLast', 'Ctrl+F24')).resolves.toBe('invalid')
  })

  it('turns itself off with one warning when the plugin is not permitted', async () => {
    const shell = shortcutShell(() =>
      refuse('global-shortcut.register not allowed. Permissions associated with this command: …'),
    )
    await expect(services.hotkeys.set('toggleLast', 'Ctrl+Alt+T')).resolves.toBe('unsupported')
    await expect(services.hotkeys.set('showApp', 'Ctrl+Alt+S')).resolves.toBe('unsupported')
    expect(shell.payloads('plugin:global-shortcut|register')).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(services.hotkeys.supported).toBe(false)
  })

  it('refuses a combo the OS fails on in another way, and keeps the other hotkeys working', async () => {
    const shell = shortcutShell((shortcut) =>
      shortcut === 'Control+Alt+KeyS' ? refuse('RegisterHotKey failed: os error 87') : null,
    )
    await expect(services.hotkeys.set('toggleLast', 'Ctrl+Alt+T')).resolves.toBe('ok')
    await expect(services.hotkeys.set('showApp', 'Ctrl+Alt+S')).resolves.toBe('invalid')
    expect(warn).toHaveBeenCalledOnce()
    expect(services.hotkeys.supported).toBe(true)
    // Removing the other one still reaches the OS, so it stops firing.
    await expect(services.hotkeys.set('toggleLast', null)).resolves.toBe('ok')
    expect(shell.payloads('plugin:global-shortcut|unregister')).toEqual([
      { shortcuts: ['Control+Alt+KeyT'] },
    ])
  })

  it('runs calls one after another', async () => {
    const shell = shortcutShell()
    const results = await Promise.all([
      services.hotkeys.set('toggleLast', 'Ctrl+Alt+1'),
      services.hotkeys.set('toggleLast', 'Ctrl+Alt+2'),
      services.hotkeys.set('showApp', 'Ctrl+Alt+3'),
    ])
    expect(results).toEqual(['ok', 'ok', 'ok'])
    expect(shell.commands().slice(1)).toEqual([
      'plugin:global-shortcut|register',
      'plugin:global-shortcut|unregister',
      'plugin:global-shortcut|register',
      'plugin:global-shortcut|register',
    ])
  })

  it('shows the app for showApp, or hides it when it has the focus, before the listeners run', async () => {
    const shell = shortcutShell()
    const pressed = vi.fn()
    services.hotkeys.onPressed(pressed)
    await services.hotkeys.set('showApp', 'Mod+Alt+Space')

    shell.press('CommandOrControl+Alt+Space')
    await vi.waitFor(() => {
      expect(pressed).toHaveBeenCalledOnce()
    })
    expect(shell.commands()).toContain('plugin:window|hide')
    expect(shell.commands()).not.toContain('plugin:window|show')

    shell.window({ visible: false, focused: false })
    shell.press('CommandOrControl+Alt+Space')
    await vi.waitFor(() => {
      expect(pressed).toHaveBeenCalledTimes(2)
    })
    const lastShown = shell.commands().slice(-3)
    expect(lastShown).toEqual([
      'plugin:window|unminimize',
      'plugin:window|show',
      'plugin:window|set_focus',
    ])
    expect(shell.payloads('plugin:window|show')).toEqual([{ label: 'main' }])
    expect(pressed).toHaveBeenLastCalledWith('showApp')
  })

  it('stops calling a listener once it unsubscribes', async () => {
    const shell = shortcutShell()
    const pressed = vi.fn()
    const stop = services.hotkeys.onPressed(pressed)
    await services.hotkeys.set('toggleLast', 'Ctrl+Alt+T')
    stop()
    shell.press('Control+Alt+KeyT')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(pressed).not.toHaveBeenCalled()
  })
})

describe('autostart', () => {
  it('reads the OS state, and turns launch at login on and off, reading it back', async () => {
    let enabled = false
    const shell = fakeShell({
      'plugin:autostart|is_enabled': () => enabled,
      'plugin:autostart|enable': () => {
        enabled = true
        return null
      },
      'plugin:autostart|disable': () => {
        enabled = false
        return null
      },
      quote_launch_entry: () => true,
    })
    await expect(services.autostart.isEnabled()).resolves.toBe(false)
    await expect(services.autostart.setEnabled(true)).resolves.toBe(true)
    await expect(services.autostart.setEnabled(false)).resolves.toBe(false)
    // Turning it on also quotes the program's path in the Windows entry the plugin wrote.
    expect(shell.commands()).toEqual([
      'plugin:autostart|is_enabled',
      'plugin:autostart|enable',
      'quote_launch_entry',
      'plugin:autostart|is_enabled',
      'plugin:autostart|disable',
      'plugin:autostart|is_enabled',
    ])
  })

  it('still turns it on when the entry cannot be quoted, with a warning', async () => {
    let enabled = false
    fakeShell({
      'plugin:autostart|is_enabled': () => enabled,
      'plugin:autostart|enable': () => {
        enabled = true
        return null
      },
      quote_launch_entry: () => refuse('could not write the Run entry (error 5)'),
    })
    await expect(services.autostart.setEnabled(true)).resolves.toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(services.autostart.supported).toBe(true)
  })

  it('springs back to the state before a failed change, then reads as unknown and unsupported', async () => {
    const shell = fakeShell({
      'plugin:autostart|disable': () => refuse('could not write the registry'),
    })
    await expect(services.autostart.setEnabled(false)).resolves.toBe(true)
    expect(services.autostart.supported).toBe(false)
    await expect(services.autostart.isEnabled()).resolves.toBeNull()
    await expect(services.autostart.setEnabled(true)).resolves.toBe(false)
    expect(shell.commands()).toEqual(['plugin:autostart|disable'])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('reads as unknown when the OS cannot be asked', async () => {
    fakeShell({ 'plugin:autostart|is_enabled': () => refuse('registry unreadable') })
    await expect(services.autostart.isEnabled()).resolves.toBeNull()
    expect(services.autostart.supported).toBe(false)
  })
})

const METADATA = {
  rid: 7,
  currentVersion: '0.1.0',
  version: '0.2.0',
  date: '2026-11-01T00:00:00Z',
  body: 'Faster timers.',
  rawJson: {},
}

describe('updater', () => {
  it('never checks in a build without the updater key', async () => {
    const shell = fakeShell({ updater_configured: () => false })
    await expect(services.updater.configured()).resolves.toBe(false)
    await expect(services.updater.check()).resolves.toBeNull()
    await expect(services.updater.install()).resolves.toBe(false)
    expect(shell.commands()).toEqual(['updater_configured'])
  })

  it('finds an update, installs it with progress and restarts', async () => {
    const shell = fakeShell({
      updater_configured: () => true,
      'plugin:updater|check': () => METADATA,
      'plugin:updater|download_and_install': (payload) => {
        const channel = payload.onEvent as ChannelLike
        channel.onmessage({ event: 'Started', data: { contentLength: 300 } })
        channel.onmessage({ event: 'Progress', data: { chunkLength: 100 } })
        channel.onmessage({ event: 'Progress', data: { chunkLength: 200 } })
        channel.onmessage({ event: 'Finished' })
        return null
      },
      'plugin:process|restart': ok,
    })
    await expect(services.updater.check()).resolves.toEqual({
      version: '0.2.0',
      currentVersion: '0.1.0',
      notes: 'Faster timers.',
      date: '2026-11-01T00:00:00Z',
    })
    const progress = vi.fn()
    await expect(services.updater.install(progress)).resolves.toBe(true)
    expect(progress.mock.calls).toEqual([
      [{ downloaded: 0, total: 300 }],
      [{ downloaded: 100, total: 300 }],
      [{ downloaded: 300, total: 300 }],
      [{ downloaded: 300, total: 300 }],
    ])
    expect(shell.payloads('plugin:updater|download_and_install')[0]).toMatchObject({ rid: 7 })
    // Installed: nothing is left to install.
    await expect(services.updater.install()).resolves.toBe(false)
    await services.updater.restart()
    expect(shell.commands()).toContain('plugin:process|restart')
    expect(shell.payloads('updater_configured')).toHaveLength(1)
  })

  it('reads a release without notes or date, and no update as null', async () => {
    let answer: unknown = { ...METADATA, date: undefined, body: undefined }
    fakeShell({ updater_configured: () => true, 'plugin:updater|check': () => answer })
    await expect(services.updater.check()).resolves.toMatchObject({ notes: null, date: null })
    answer = null
    await expect(services.updater.check()).resolves.toBeNull()
  })

  it('frees the previous update when a later check replaces it', async () => {
    const shell = fakeShell({
      updater_configured: () => true,
      'plugin:updater|check': () => METADATA,
      'plugin:resources|close': ok,
    })
    await services.updater.check()
    await services.updater.check()
    await vi.waitFor(() => {
      expect(shell.payloads('plugin:resources|close')).toEqual([{ rid: 7 }])
    })
  })

  it('resolves a failed check to failed with a warning, and checks again next time', async () => {
    const shell = fakeShell({
      updater_configured: () => true,
      'plugin:updater|check': () => refuse('error sending request for url'),
    })
    await expect(services.updater.check()).resolves.toBe('failed')
    await expect(services.updater.check()).resolves.toBe('failed')
    expect(shell.payloads('plugin:updater|check')).toHaveLength(2)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(services.updater.supported).toBe(true)
  })

  it('resolves a failed install to false with a warning', async () => {
    fakeShell({
      updater_configured: () => true,
      'plugin:updater|check': () => METADATA,
      'plugin:updater|download_and_install': () => refuse('signature mismatch'),
    })
    await services.updater.check()
    await expect(services.updater.install()).resolves.toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('reads a failing updater_configured as not configured, and turns itself off', async () => {
    fakeShell()
    await expect(services.updater.configured()).resolves.toBe(false)
    await expect(services.updater.check()).resolves.toBeNull()
    expect(warn).toHaveBeenCalledOnce()
    expect(services.updater.supported).toBe(false)
  })
})

describe('opener', () => {
  it('opens http and https URLs in the system browser', async () => {
    const shell = fakeShell({ 'plugin:opener|open_url': ok })
    // The server's verification_uri_complete under `tauri dev` (BETTER_AUTH_URL is Vite's).
    await expect(
      services.opener.open('http://localhost:5173/device?user_code=ABCD-EFGH'),
    ).resolves.toBe(true)
    expect(shell.calls).toEqual([
      ['plugin:opener|open_url', { url: 'http://localhost:5173/device?user_code=ABCD-EFGH' }],
    ])
  })

  it('refuses other URLs with a warning, without asking the shell', async () => {
    const shell = fakeShell({ 'plugin:opener|open_url': ok })
    for (const url of ['file:///C:/Windows/notepad.exe', 'javascript:alert(1)', '/device']) {
      await expect(services.opener.open(url)).resolves.toBe(false)
    }
    expect(shell.calls).toEqual([])
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('reports a URL the shell refuses, and still opens the next one', async () => {
    const shell = fakeShell({
      'plugin:opener|open_url': ({ url }) =>
        url === 'https://example.com/' ? null : refuse(`Not allowed to open url ${String(url)}`),
    })
    await expect(services.opener.open('http://192.168.1.5:8787/device')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledOnce()
    expect(services.opener.supported).toBe(true)
    await expect(services.opener.open('https://example.com/')).resolves.toBe(true)
    expect(shell.payloads('plugin:opener|open_url')).toHaveLength(2)
  })
})

/**
 * The plugin's stand-in for the web `Notification`, as its init script installs it in the
 * webview: constructing one invokes `notify`.
 */
async function notificationStandIn(permission: NotificationPermission): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  function Notification(title: string, options: object = {}): void {
    void invoke('plugin:notification|notify', { options: { ...options, title } })
  }
  Notification.permission = permission
  Notification.requestPermission = () => invoke('plugin:notification|request_permission')
  vi.stubGlobal('Notification', Notification)
}

/** The notification plugin, holding its click listener's channel. */
function notificationShell() {
  let clicks: ChannelLike | undefined
  /** When the shell finished registering the click listener and showing each notification. */
  const done: string[] = []
  const shell = fakeShell({
    'plugin:notification|notify': () => {
      done.push('notify')
      return null
    },
    'plugin:notification|remove_active': ok,
    'plugin:notification|is_permission_granted': () => true,
    'plugin:notification|request_permission': () => 'granted',
    // Answers late, as a real round trip does: nothing may be shown before it has answered.
    'plugin:notification|register_listener': (payload) => {
      clicks = payload.handler as ChannelLike
      return new Promise((resolve) => {
        setTimeout(() => {
          done.push('register_listener')
          resolve(null)
        }, 5)
      })
    },
    'plugin:window|unminimize': ok,
    'plugin:window|show': ok,
    'plugin:window|set_focus': ok,
  })
  return {
    ...shell,
    done,
    click(id: number, actionId = 'tap') {
      clicks?.onmessage({ actionId, inputValue: null, notification: { id } })
    },
  }
}

describe('notifications', () => {
  it('reads the permission the plugin settled at startup', async () => {
    notificationShell()
    await notificationStandIn('granted')
    expect(services.notifications.permission()).toBe('granted')
    vi.stubGlobal('Notification', undefined)
    expect(services.notifications.permission()).toBe('default')
  })

  it('asks the plugin for permission and remembers the answer', async () => {
    const shell = notificationShell()
    await notificationStandIn('default')
    await expect(services.notifications.request()).resolves.toBe(true)
    expect(shell.commands()).toEqual(['plugin:notification|is_permission_granted'])
    expect(services.notifications.permission()).toBe('granted')
  })

  it('shows a notification with an id of its tag and removes it on close', async () => {
    const shell = notificationShell()
    await notificationStandIn('granted')
    const handle = services.notifications.show({ title: 'Tea', body: "Time's up", tag: 'card-1' })
    expect(handle).not.toBeNull()
    const id = notificationId('card-1')
    await vi.waitFor(() => {
      expect(shell.payloads('plugin:notification|notify')).toEqual([
        { options: { id, title: 'Tea', body: "Time's up" } },
      ])
    })
    handle?.close()
    handle?.close()
    await vi.waitFor(() => {
      expect(shell.payloads('plugin:notification|remove_active')).toEqual([
        { notifications: [{ id }] },
      ])
    })
    // Without a click handler there is nothing to listen for.
    expect(shell.commands()).not.toContain('plugin:notification|register_listener')
  })

  it('shows nothing without permission', async () => {
    const shell = notificationShell()
    await notificationStandIn('denied')
    expect(services.notifications.show({ title: 'Tea', body: '', tag: 'card-1' })).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(shell.calls).toEqual([])
  })

  it('brings the window back, then runs onClick, when the notification is clicked', async () => {
    const shell = notificationShell()
    await notificationStandIn('granted')
    const onClick = vi.fn(() => {
      // The window is on screen by now.
      expect(shell.commands()).toContain('plugin:window|set_focus')
    })
    services.notifications.show({ title: 'Tea', body: '', tag: 'card-1', onClick })
    await vi.waitFor(() => {
      expect(shell.commands()).toContain('plugin:notification|notify')
    })
    // The listener is in place before the notification is shown, or its click goes unreported.
    expect(shell.done).toEqual(['register_listener', 'notify'])
    shell.click(notificationId('another card'))
    shell.click(notificationId('card-1'), 'snooze')
    shell.click(notificationId('card-1'))
    await vi.waitFor(() => {
      expect(onClick).toHaveBeenCalledOnce()
    })
    shell.click(notificationId('card-1'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onClick).toHaveBeenCalledOnce()
    expect(shell.payloads('plugin:notification|register_listener')).toHaveLength(1)
  })

  it('forgets the click of a notification closed before it was clicked', async () => {
    const shell = notificationShell()
    await notificationStandIn('granted')
    const onClick = vi.fn()
    const handle = services.notifications.show({ title: 'Tea', body: '', tag: 'card-1', onClick })
    await vi.waitFor(() => {
      expect(shell.commands()).toContain('plugin:notification|notify')
    })
    handle?.close()
    shell.click(notificationId('card-1'))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('gives the same tag the same id, a positive 32-bit integer', () => {
    expect(notificationId('card-1')).toBe(notificationId('card-1'))
    expect(notificationId('card-1')).not.toBe(notificationId('card-2'))
    for (const tag of ['', 'a', '0f8fad5b-d9cb-469f-a165-70867728950e', '茶']) {
      const id = notificationId(tag)
      expect(Number.isInteger(id) && id > 0 && id <= 0x7fffffff).toBe(true)
    }
  })

  it('reports unsupported, with one warning, once the plugin fails', async () => {
    fakeShell({ 'plugin:notification|is_permission_granted': () => refuse('denied') })
    await notificationStandIn('default')
    await expect(services.notifications.request()).resolves.toBe(false)
    expect(services.notifications.permission()).toBe('unsupported')
    expect(services.notifications.show({ title: 'Tea', body: '', tag: 'card-1' })).toBeNull()
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('mini window', () => {
  function miniShell(windows: string[] = ['main']) {
    return fakeShell({
      open_mini: ok,
      close_mini: ok,
      set_mini_always_on_top: ok,
      'plugin:window|get_all_windows': () => windows,
    })
  }

  it('opens the mini window on a card, floating by default, without the render callback', async () => {
    const shell = miniShell()
    const changes = vi.fn()
    services.windows.onChange(changes)
    const render = vi.fn(() => () => undefined)
    await services.windows.open('card-1', render)
    await services.windows.open('card-2', render, { alwaysOnTop: false })
    expect(shell.payloads('open_mini')).toEqual([
      { card: 'card-1', alwaysOnTop: true },
      { card: 'card-2', alwaysOnTop: false },
    ])
    expect(render).not.toHaveBeenCalled()
    expect(services.windows.isOpen()).toBe(true)
    expect(changes.mock.calls).toEqual([[true]])
  })

  it('hears the mini window close, however it closed', async () => {
    const shell = miniShell()
    const changes = vi.fn()
    services.windows.onChange(changes)
    await services.windows.open('card-1', () => () => undefined)
    expect(shell.listeners).toMatchObject([
      { event: 'mini-closed', target: { kind: 'WebviewWindow', label: 'main' } },
    ])
    shell.emit('mini-closed', null)
    expect(services.windows.isOpen()).toBe(false)
    expect(changes.mock.calls).toEqual([[true], [false]])
  })

  it('closes it and pins it through the shell', async () => {
    const shell = miniShell()
    await services.windows.open('card-1', () => () => undefined)
    await services.windows.setAlwaysOnTop(false)
    await services.windows.close()
    expect(services.windows.isOpen()).toBe(false)
    expect(shell.calls.filter(([cmd]) => !cmd.startsWith('plugin:'))).toEqual([
      ['open_mini', { card: 'card-1', alwaysOnTop: true }],
      ['set_mini_always_on_top', { flag: false }],
      ['close_mini', {}],
    ])
  })

  it('finds a mini window that opened before this page loaded', async () => {
    miniShell(['main', 'mini'])
    const changes = vi.fn()
    services.windows.onChange(changes)
    await vi.waitFor(() => {
      expect(services.windows.isOpen()).toBe(true)
    })
    expect(changes).toHaveBeenCalledWith(true)
  })

  it('turns itself off with one warning when the shell cannot open it', async () => {
    const shell = fakeShell({
      open_mini: () => refuse('could not open the mini window: …'),
      'plugin:window|get_all_windows': () => ['main'],
    })
    await expect(services.windows.open('card-1', () => () => undefined)).resolves.toBeUndefined()
    await services.windows.open('card-1', () => () => undefined)
    expect(services.windows.isOpen()).toBe(false)
    expect(shell.payloads('open_mini')).toHaveLength(1)
    expect(warn).toHaveBeenCalledOnce()
    // The card header's button, T and the palette command go at their next render.
    expect(services.windows.supported).toBe(false)
  })

  it('closes and pins the mini window from its own page with the shell commands alone', async () => {
    mockWindows('mini')
    const shell = fakeShell({ close_mini: ok, set_mini_always_on_top: ok })
    const page = createTauriServices()
    await page.windows.setAlwaysOnTop(false)
    await page.windows.close()
    // Nothing its capability does not grant (no window list, no listening for mini-closed).
    expect(shell.commands()).toEqual(['set_mini_always_on_top', 'close_mini'])
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('shell', () => {
  const LABELS = {
    show: 'Timer App を表示',
    toggleLast: '最後のカードを開始/一時停止',
    quit: '終了',
  }

  it('sends the tray labels, each set once', async () => {
    const shell = fakeShell({ set_tray_labels: ok })
    services.shell.setTrayLabels(LABELS)
    services.shell.setTrayLabels({ ...LABELS })
    await vi.waitFor(() => {
      expect(shell.calls).toHaveLength(1)
    })
    services.shell.setTrayLabels({ ...LABELS, quit: 'Quit' })
    await vi.waitFor(() => {
      expect(shell.calls).toHaveLength(2)
    })
    expect(shell.payloads('set_tray_labels')).toEqual([
      { labels: LABELS },
      { labels: { ...LABELS, quit: 'Quit' } },
    ])
  })

  it('tells the mini window page which card to show', async () => {
    mockWindows('mini')
    const shell = fakeShell()
    const cards = vi.fn()
    const stop = createTauriServices().shell.onMiniCard(cards)
    await vi.waitFor(() => {
      expect(shell.listeners).toMatchObject([
        { event: 'mini-card', target: { kind: 'WebviewWindow', label: 'mini' } },
      ])
    })
    shell.emit('mini-card', 'card-2')
    shell.emit('mini-card', '')
    shell.emit('mini-card', 7)
    expect(cards.mock.calls).toEqual([['card-2']])
    stop()
    await vi.waitFor(() => {
      expect(shell.listeners).toEqual([])
    })
  })

  it('prints smoke marks in development builds', async () => {
    const shell = fakeShell({ smoke_mark: ok })
    services.shell.smokeMark('ringing card-1')
    await vi.waitFor(() => {
      expect(shell.calls).toEqual([['smoke_mark', { message: 'ringing card-1' }]])
    })
  })
})
