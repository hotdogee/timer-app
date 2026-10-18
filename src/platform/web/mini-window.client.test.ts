import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MiniWindowRender } from '../types'
import {
  MINI_WINDOW_ROOT_CLASS,
  MINI_WINDOW_SIZE,
  createWebMiniWindow,
  type PictureInPictureWindow,
} from './mini-window'

/** A Picture-in-Picture window: an empty document, closed by `close()` with a `pagehide`. */
class FakeWindow extends EventTarget implements PictureInPictureWindow {
  readonly document = document.implementation.createHTMLDocument('')
  readonly focus = vi.fn()
  closed = false

  close(): void {
    if (this.closed) return
    this.closed = true
    this.dispatchEvent(new Event('pagehide'))
  }
}

/** The app's page, with what the controller copies: stylesheets, the theme, the root attributes. */
function opener(): Document {
  const doc = document.implementation.createHTMLDocument('Timer App')
  doc.documentElement.lang = 'ja'
  doc.documentElement.dataset.theme = 'dark'
  doc.documentElement.dataset.density = 'compact'
  doc.documentElement.style.setProperty('--digit-scale', '1.2')
  doc.head.innerHTML = [
    '<base href="http://localhost:5173/">',
    '<title>Timer App</title>',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="description" content="Timers">',
    '<link rel="stylesheet" href="/assets/index-abc.css" media="screen">',
    '<link rel="icon" href="/favicon.svg">',
    '<style>.card { color: red }</style>',
    '<style id="theme">:root { --md-sys-color-primary: #0b57d0 }</style>',
  ].join('')
  return doc
}

/** A fake `documentPictureInPicture` whose windows the test can reach. */
function picture() {
  const windows: FakeWindow[] = []
  const requestWindow = vi.fn((options?: { width?: number; height?: number }) => {
    void options
    const window = new FakeWindow()
    windows.push(window)
    return Promise.resolve(window)
  })
  return { windows, requestWindow }
}

/** A render callback that draws the card id and records its cleanups. */
function renderer() {
  const cleanups: string[] = []
  const render = vi.fn<MiniWindowRender>((target, cardId) => {
    const card = target.ownerDocument.createElement('p')
    card.textContent = cardId
    target.append(card)
    return () => {
      cleanups.push(cardId)
    }
  })
  return { render, cleanups }
}

/** Lets the mutation observers run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createWebMiniWindow', () => {
  it('is supported only with Document Picture-in-Picture', () => {
    expect(createWebMiniWindow({ document: opener() }).supported).toBe(false)
    expect(createWebMiniWindow({}).supported).toBe(false)
    expect(
      createWebMiniWindow({ documentPictureInPicture: picture(), document: opener() }).supported,
    ).toBe(true)
    // jsdom, like Firefox and Safari, has no documentPictureInPicture.
    expect(createWebMiniWindow().supported).toBe(false)
  })

  it('does nothing where unsupported', async () => {
    const mini = createWebMiniWindow({ document: opener() })
    const { render } = renderer()
    await mini.open('card-1', render)
    expect(render).not.toHaveBeenCalled()
    expect(mini.isOpen()).toBe(false)
    await expect(mini.close()).resolves.toBeUndefined()
    await expect(mini.setAlwaysOnTop(false)).resolves.toBeUndefined()
  })

  it('opens a 320×200 window, copies the app’s look into it, then draws the card', async () => {
    const pip = picture()
    const page = opener()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: page })
    const { render } = renderer()
    const changes = vi.fn()
    mini.onChange(changes)
    await mini.open('card-1', render)

    expect(pip.requestWindow).toHaveBeenCalledWith(MINI_WINDOW_SIZE)
    expect(MINI_WINDOW_SIZE).toEqual({ width: 320, height: 200 })
    const doc = pip.windows[0]?.document
    if (!doc) throw new Error('no window')
    const root = doc.documentElement
    expect(root.lang).toBe('ja')
    expect(root.dataset.theme).toBe('dark')
    expect(root.dataset.density).toBe('compact')
    expect(root.style.getPropertyValue('--digit-scale')).toBe('1.2')
    expect(doc.title).toBe('Timer App')

    const head = [...doc.head.children].map((node) => node.outerHTML)
    expect(head).toEqual([
      '<title>Timer App</title>',
      '<meta name="color-scheme" content="light dark">',
      '<link rel="stylesheet" href="http://localhost:5173/assets/index-abc.css" media="screen">',
      '<style>.card { color: red }</style>',
      '<style id="theme">:root { --md-sys-color-primary: #0b57d0 }</style>',
    ])

    // The card goes into the window's one root element, after the styles are in place.
    const target = render.mock.calls[0]?.[0]
    expect(target?.ownerDocument).toBe(doc)
    expect(target?.parentElement).toBe(doc.body)
    expect(target?.className).toBe(MINI_WINDOW_ROOT_CLASS)
    expect(render).toHaveBeenCalledWith(target, 'card-1')
    expect(doc.body.textContent).toBe('card-1')
    expect(mini.isOpen()).toBe(true)
    expect(changes.mock.calls).toEqual([[true]])
  })

  it('asks for the window synchronously, inside the user gesture the browser requires', async () => {
    const pip = picture()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: opener() })
    const opened = mini.open('card-1', renderer().render)
    expect(pip.requestWindow).toHaveBeenCalledOnce()
    await opened
    expect(mini.isOpen()).toBe(true)
  })

  it('keeps the window’s look in step with the app while it is open', async () => {
    const pip = picture()
    const page = opener()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: page })
    await mini.open('card-1', renderer().render)
    const doc = pip.windows[0]?.document
    if (!doc) throw new Error('no window')

    // A new theme, a stylesheet loaded with a lazy chunk, another language and scheme.
    const theme = page.getElementById('theme')
    if (theme) theme.textContent = ':root { --md-sys-color-primary: #8e24aa }'
    const lazy = page.createElement('link')
    lazy.rel = 'stylesheet'
    lazy.href = '/assets/Settings-def.css'
    page.head.append(lazy)
    page.head.querySelector('style:not([id])')?.remove()
    page.documentElement.lang = 'zh-TW'
    page.documentElement.removeAttribute('data-theme')
    await settle()

    expect(doc.getElementById('theme')?.textContent).toBe(
      ':root { --md-sys-color-primary: #8e24aa }',
    )
    expect([...doc.head.querySelectorAll('link')].map((link) => link.href)).toEqual([
      'http://localhost:5173/assets/index-abc.css',
      'http://localhost:5173/assets/Settings-def.css',
    ])
    expect(doc.head.querySelectorAll('style')).toHaveLength(1)
    expect(doc.documentElement.lang).toBe('zh-TW')
    expect(doc.documentElement.hasAttribute('data-theme')).toBe(false)

    // Once closed it follows nothing more.
    await mini.close()
    page.documentElement.lang = 'en'
    await settle()
    expect(doc.documentElement.lang).toBe('zh-TW')
  })

  it('switches the open window to another card and focuses it', async () => {
    const pip = picture()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: opener() })
    const { render, cleanups } = renderer()
    const changes = vi.fn()
    mini.onChange(changes)
    await mini.open('card-1', render)
    await mini.open('card-2', render)
    expect(pip.requestWindow).toHaveBeenCalledOnce()
    expect(cleanups).toEqual(['card-1'])
    expect(pip.windows[0]?.document.body.textContent).toBe('card-2')
    expect(pip.windows[0]?.focus).toHaveBeenCalledOnce()
    expect(changes.mock.calls).toEqual([[true]])
  })

  it('opens one window when asked twice before the first opened', async () => {
    const pip = picture()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: opener() })
    const { render } = renderer()
    await Promise.all([mini.open('card-1', render), mini.open('card-2', render)])
    expect(pip.requestWindow).toHaveBeenCalledOnce()
    expect(pip.windows[0]?.document.body.textContent).toBe('card-2')
  })

  it('cleans up on pagehide, however the window closed', async () => {
    const pip = picture()
    const page = opener()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: page })
    const { render, cleanups } = renderer()
    const changes = vi.fn()
    mini.onChange(changes)
    await mini.open('card-1', render)

    // The user closes it with the window's own button.
    pip.windows[0]?.close()
    expect(cleanups).toEqual(['card-1'])
    expect(mini.isOpen()).toBe(false)
    expect(changes.mock.calls).toEqual([[true], [false]])
    page.documentElement.lang = 'en'
    await settle()
    expect(pip.windows[0]?.document.documentElement.lang).toBe('ja')

    // The next open asks for a new window.
    await mini.open('card-2', render)
    expect(pip.requestWindow).toHaveBeenCalledTimes(2)
    expect(pip.windows[1]?.document.body.textContent).toBe('card-2')
  })

  it('closes the window from the app, cleaning up once', async () => {
    const pip = picture()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: opener() })
    const { render, cleanups } = renderer()
    const changes = vi.fn()
    const stop = mini.onChange(changes)
    await mini.open('card-1', render)
    await mini.close()
    await mini.close()
    expect(pip.windows[0]?.closed).toBe(true)
    expect(cleanups).toEqual(['card-1'])
    expect(changes.mock.calls).toEqual([[true], [false]])
    stop()
    await mini.open('card-2', render)
    expect(changes).toHaveBeenCalledTimes(2)
  })

  it('never rejects when the browser refuses the window (no user gesture)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const mini = createWebMiniWindow({
      documentPictureInPicture: {
        requestWindow: () =>
          Promise.reject(new DOMException('No user activation', 'NotAllowedError')),
      },
      document: opener(),
    })
    const { render } = renderer()
    await expect(mini.open('card-1', render)).resolves.toBeUndefined()
    expect(render).not.toHaveBeenCalled()
    expect(mini.isOpen()).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('closes the window again when its code cannot load (offline before it was cached)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.resetModules()
    vi.doMock('./mini-window-session', () => Promise.reject(new Error('Failed to fetch')))
    try {
      const { createWebMiniWindow: create } = await import('./mini-window')
      const pip = picture()
      const mini = create({ documentPictureInPicture: pip, document: opener() })
      const { render } = renderer()
      await expect(mini.open('card-1', render)).resolves.toBeUndefined()
      expect(pip.windows[0]?.closed).toBe(true)
      expect(render).not.toHaveBeenCalled()
      expect(mini.isOpen()).toBe(false)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      vi.doUnmock('./mini-window-session')
      vi.resetModules()
    }
  })

  it('keeps the window open when drawing the card throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const pip = picture()
    const mini = createWebMiniWindow({ documentPictureInPicture: pip, document: opener() })
    await mini.open('card-1', () => {
      throw new Error('no such card')
    })
    expect(mini.isOpen()).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    pip.windows[0]?.close()
    expect(mini.isOpen()).toBe(false)
  })
})
