import { afterEach, describe, expect, it, vi } from 'vitest'

import { webAccent } from './accent'
import {
  DEFAULT_SOUND,
  DEFAULT_VOLUME,
  HOTKEY_RESULTS,
  SOUND_IDS,
  createPlatform,
  createWebOpener,
  detectKind,
  platform,
  unsupportedMiniWindow,
} from '.'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('webAccent', () => {
  it('answers null, because browsers do not expose the OS accent color', async () => {
    await expect(webAccent.get()).resolves.toBeNull()
  })
})

describe('detectKind', () => {
  it('detects the Tauri webview by its isTauri global', () => {
    expect(detectKind({ isTauri: true })).toBe('tauri')
    expect(detectKind({})).toBe('web')
    expect(detectKind({ isTauri: false })).toBe('web')
  })

  it('reports web under Node', () => {
    expect(detectKind()).toBe('web')
  })
})

describe('platform', () => {
  it('loads outside a browser and provides every service', () => {
    expect(platform.kind).toBe('web')
    for (const service of [
      platform.accent,
      platform.notifications,
      platform.audio,
      platform.wake,
      platform.ids,
      platform.fullscreen,
      platform.windows,
      platform.hotkeys,
      platform.autostart,
      platform.updater,
      platform.activity,
      platform.opener,
      platform.shell,
    ]) {
      expect(service).toBeTypeOf('object')
    }
  })

  it('has no desktop services on the web, and every call on them resolves harmlessly', async () => {
    const p = createPlatform('web')
    for (const service of [p.windows, p.hotkeys, p.autostart, p.updater, p.activity, p.shell]) {
      expect(service.supported).toBe(false)
    }
    const render = vi.fn(() => () => undefined)
    expect(p.windows.isOpen()).toBe(false)
    await expect(p.windows.open('card', render, { alwaysOnTop: false })).resolves.toBeUndefined()
    expect(render).not.toHaveBeenCalled()
    expect(p.windows.isOpen()).toBe(false)
    await expect(p.windows.setAlwaysOnTop(true)).resolves.toBeUndefined()
    await expect(p.windows.close()).resolves.toBeUndefined()
    expect(p.windows.onChange(() => undefined)).toBeTypeOf('function')

    await expect(p.hotkeys.set('toggleLast', 'Mod+Shift+Space')).resolves.toBe('unsupported')
    await expect(p.hotkeys.set('showApp', null)).resolves.toBe('unsupported')
    p.hotkeys.onPressed(() => undefined)()

    await expect(p.autostart.isEnabled()).resolves.toBeNull()
    await expect(p.autostart.setEnabled(true)).resolves.toBe(false)

    await expect(p.updater.configured()).resolves.toBe(false)
    await expect(p.updater.check()).resolves.toBeNull()
    await expect(p.updater.install(() => undefined)).resolves.toBe(false)
    await expect(p.updater.restart()).resolves.toBeUndefined()

    p.activity.setRunning(true)
    p.activity.setCloseBehavior('quit')
    p.activity.onToggleLast(() => undefined)()

    p.shell.setTrayLabels({ show: 'Show', toggleLast: 'Toggle', quit: 'Quit' })
    p.shell.onMiniCard(() => undefined)()
    p.shell.smokeMark('ringing')
    expect(p.accent.onChange?.(() => undefined)).toBeTypeOf('function')
  })

  it('picks the desktop services for the Tauri webview, which touch nothing until used', () => {
    const web = createPlatform('web')
    const p = createPlatform('tauri')
    for (const service of [
      p.notifications,
      p.windows,
      p.hotkeys,
      p.autostart,
      p.updater,
      p.activity,
      p.opener,
      p.shell,
    ]) {
      expect(service.supported).toBe(true)
    }
    expect(p.accent).not.toBe(web.accent)
    expect(p.windows.isOpen()).toBe(false)
    // The web implementations serve the desktop app too where the shell adds nothing.
    for (const name of ['audio', 'wake', 'ids', 'fullscreen'] as const) {
      expect(Object.keys(p[name]).sort()).toEqual(Object.keys(web[name]).sort())
    }
  })

  it('lists every hotkey result', () => {
    expect(HOTKEY_RESULTS).toEqual(['ok', 'taken', 'invalid', 'unsupported'])
  })

  it('degrades gracefully where the browser APIs are missing', async () => {
    const p = createPlatform('web')
    expect(p.notifications.supported).toBe(false)
    expect(p.notifications.permission()).toBe('unsupported')
    await expect(p.notifications.request()).resolves.toBe(false)
    expect(p.fullscreen.supported).toBe(false)
    expect(p.audio.playing).toBe(false)
    p.audio.unlock()
    p.audio.play(DEFAULT_SOUND, { loop: true, volume: DEFAULT_VOLUME })
    expect(p.audio.playing).toBe(true)
    p.audio.stop()
    expect(p.audio.playing).toBe(false)
    expect(p.ids.newId()).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('gives the web the Picture-in-Picture mini window, unsupported without the API', () => {
    const windows = createPlatform('web').windows
    expect(windows).not.toBe(unsupportedMiniWindow)
    expect(windows.supported).toBe(false)
  })

  it('keeps the kind it was built for', () => {
    expect(createPlatform('tauri').kind).toBe('tauri')
  })

  it('exports the built-in sound ids and alarm defaults', () => {
    expect(SOUND_IDS).toContain(DEFAULT_SOUND)
    expect(DEFAULT_SOUND).toBe('chime')
    expect(DEFAULT_VOLUME).toBe(0.8)
  })
})

describe('createWebOpener', () => {
  function scope() {
    return { open: vi.fn<(url: string, target: string, features: string) => unknown>() }
  }

  it('opens http and https URLs in a new tab that cannot reach back to the app', async () => {
    const window = scope()
    const opener = createWebOpener(window)
    expect(opener.supported).toBe(true)
    await expect(opener.open('http://localhost:8787/device?user_code=ABCD-EFGH')).resolves.toBe(
      true,
    )
    await expect(opener.open('https://timer.example.com/device')).resolves.toBe(true)
    expect(window.open.mock.calls).toEqual([
      ['http://localhost:8787/device?user_code=ABCD-EFGH', '_blank', 'noopener'],
      ['https://timer.example.com/device', '_blank', 'noopener'],
    ])
  })

  it('refuses other URLs with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const window = scope()
    const opener = createWebOpener(window)
    for (const url of ['javascript:alert(1)', 'file:///C:/Windows', '/device', 'not a url', '']) {
      await expect(opener.open(url)).resolves.toBe(false)
    }
    expect(window.open).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(5)
  })

  it('never rejects when the browser refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const opener = createWebOpener({
      open: () => {
        throw new Error('blocked')
      },
    })
    await expect(opener.open('https://example.com')).resolves.toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('is unsupported without window.open, as under Node', async () => {
    const opener = createWebOpener({})
    expect(opener.supported).toBe(false)
    await expect(opener.open('https://example.com')).resolves.toBe(false)
    expect(createWebOpener().supported).toBe(false)
  })
})
