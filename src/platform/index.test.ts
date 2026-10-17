import { describe, expect, it } from 'vitest'

import { webAccent } from './accent'
import { DEFAULT_SOUND, DEFAULT_VOLUME, SOUND_IDS, createPlatform, detectKind, platform } from '.'

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
    ]) {
      expect(service).toBeTypeOf('object')
    }
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

  it('keeps the kind it was built for', () => {
    expect(createPlatform('tauri').kind).toBe('tauri')
  })

  it('exports the built-in sound ids and alarm defaults', () => {
    expect(SOUND_IDS).toContain(DEFAULT_SOUND)
    expect(DEFAULT_SOUND).toBe('chime')
    expect(DEFAULT_VOLUME).toBe(0.8)
  })
})
