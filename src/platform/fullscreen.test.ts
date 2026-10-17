import { afterEach, describe, expect, it, vi } from 'vitest'

import { FALLBACK_ATTRIBUTE, createWebFullscreen } from './fullscreen'

/** Just enough of an element: attributes, connection state, and optionally the Fullscreen API. */
class FakeElement {
  readonly attributes = new Map<string, string>()
  isConnected = true
  requestFullscreen?: () => Promise<void>
  webkitRequestFullscreen?: () => void
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }
  get html(): HTMLElement {
    return this as unknown as HTMLElement
  }
}

/** A document with the standard Fullscreen API, which grants every request unless told not to. */
class NativeDocument extends EventTarget {
  fullscreenEnabled = true
  fullscreenElement: Element | null = null
  refuse = false
  readonly exitFullscreen = vi.fn(() => {
    this.change(null)
    return Promise.resolve()
  })
  element(): FakeElement {
    const el = new FakeElement()
    el.requestFullscreen = () => {
      if (this.refuse) return Promise.reject(new TypeError('Permissions check failed'))
      this.change(el)
      return Promise.resolve()
    }
    return el
  }
  /** What the browser does on entering or leaving fullscreen (including the user pressing Esc). */
  change(el: FakeElement | null): void {
    this.fullscreenElement = el as unknown as Element | null
    this.dispatchEvent(new Event('fullscreenchange'))
  }
  get doc(): Document {
    return this as unknown as Document
  }
}

/** A document without the Fullscreen API (iPhone Safari). */
class PlainDocument extends EventTarget {
  get doc(): Document {
    return this as unknown as Document
  }
}

function keydown(key: string): Event {
  return Object.assign(new Event('keydown', { cancelable: true }), { key })
}

describe('createWebFullscreen with the Fullscreen API', () => {
  it('reports support', () => {
    expect(createWebFullscreen(new NativeDocument().doc).supported).toBe(true)
  })

  it('enters and exits native fullscreen and reports both changes', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const changes: (Element | null)[] = []
    fullscreen.onChange((element) => changes.push(element))
    const el = doc.element()

    await fullscreen.enter(el.html)
    expect(fullscreen.element).toBe(el)
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)

    await fullscreen.exit()
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1)
    expect(fullscreen.element).toBeNull()
    expect(changes).toEqual([el, null])
  })

  it('reports the user leaving fullscreen through the browser', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const listener = vi.fn()
    fullscreen.onChange(listener)
    await fullscreen.enter(doc.element().html)
    doc.change(null)
    expect(listener).toHaveBeenLastCalledWith(null)
    expect(fullscreen.element).toBeNull()
  })

  it('does nothing when the element is already fullscreen, or when exiting with nothing fullscreen', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const el = doc.element()
    const request = vi.spyOn(el, 'requestFullscreen')
    await fullscreen.exit()
    expect(doc.exitFullscreen).not.toHaveBeenCalled()
    await fullscreen.enter(el.html)
    await fullscreen.enter(el.html)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('toggles: enters for an element that is not fullscreen, leaves for the one that is', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const first = doc.element()
    const second = doc.element()
    await fullscreen.toggle(first.html)
    expect(fullscreen.element).toBe(first)
    await fullscreen.toggle(second.html)
    expect(fullscreen.element).toBe(second)
    await fullscreen.toggle(second.html)
    expect(fullscreen.element).toBeNull()
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1)
  })

  it('leaves fullscreen completely after switching elements, which stacks them', async () => {
    const doc = new NativeDocument()
    // The browser keeps a stack: exitFullscreen() shows the element below again.
    const stack: FakeElement[] = []
    doc.exitFullscreen.mockImplementation(() => {
      stack.pop()
      doc.change(stack.at(-1) ?? null)
      return Promise.resolve()
    })
    const fullscreen = createWebFullscreen(doc.doc)
    const first = doc.element()
    const second = doc.element()
    for (const el of [first, second]) {
      const request = el.requestFullscreen
      el.requestFullscreen = () => {
        stack.push(el)
        return request?.() ?? Promise.resolve()
      }
    }
    await fullscreen.enter(first.html)
    await fullscreen.enter(second.html)
    await fullscreen.exit()
    expect(fullscreen.element).toBeNull()
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(2)
  })

  it('switches to another element', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const first = doc.element()
    const second = doc.element()
    await fullscreen.enter(first.html)
    await fullscreen.enter(second.html)
    expect(fullscreen.element).toBe(second)
  })

  it('falls back to the overlay when the browser refuses', async () => {
    const doc = new NativeDocument()
    doc.refuse = true
    const fullscreen = createWebFullscreen(doc.doc)
    const listener = vi.fn()
    fullscreen.onChange(listener)
    const el = doc.element()
    await expect(fullscreen.enter(el.html)).resolves.toBeUndefined()
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
    expect(fullscreen.element).toBe(el)
    expect(listener).toHaveBeenCalledExactlyOnceWith(el)
  })

  it('leaves native fullscreen on another element before falling back to the overlay', async () => {
    // Chrome consumes the user gesture on the first request, so switching cards can be refused.
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const first = doc.element()
    const second = doc.element()
    await fullscreen.enter(first.html)
    doc.refuse = true
    const listener = vi.fn()
    fullscreen.onChange(listener)

    await fullscreen.enter(second.html)
    expect(doc.exitFullscreen).toHaveBeenCalledTimes(1)
    expect(doc.fullscreenElement).toBeNull()
    expect(second.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
    expect(fullscreen.element).toBe(second)
    expect(listener).toHaveBeenLastCalledWith(second)

    await fullscreen.exit()
    expect(second.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    expect(fullscreen.element).toBeNull()
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('falls back to the overlay for an element without requestFullscreen', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const el = new FakeElement()
    await fullscreen.enter(el.html)
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
  })

  it('replaces an overlay with native fullscreen once the browser allows it', async () => {
    const doc = new NativeDocument()
    doc.refuse = true
    const fullscreen = createWebFullscreen(doc.doc)
    const first = doc.element()
    await fullscreen.enter(first.html)
    doc.refuse = false
    const listener = vi.fn()
    fullscreen.onChange(listener)
    const second = doc.element()
    await fullscreen.enter(second.html)
    expect(first.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    expect(fullscreen.element).toBe(second)
    expect(listener).toHaveBeenCalledExactlyOnceWith(second)
  })

  it('resolves exit even when the browser rejects it', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    await fullscreen.enter(doc.element().html)
    doc.exitFullscreen.mockImplementationOnce(() => Promise.reject(new TypeError('Not active')))
    await expect(fullscreen.exit()).resolves.toBeUndefined()
  })

  it('listens to the document only while someone subscribes', () => {
    const doc = new NativeDocument()
    const add = vi.spyOn(doc, 'addEventListener')
    const remove = vi.spyOn(doc, 'removeEventListener')
    const fullscreen = createWebFullscreen(doc.doc)
    const a = vi.fn()
    const b = vi.fn()
    const offA = fullscreen.onChange(a)
    const offB = fullscreen.onChange(b)
    expect(add).toHaveBeenCalledTimes(1)
    offA()
    offA()
    expect(remove).not.toHaveBeenCalled()
    const el = doc.element()
    doc.change(el)
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledExactlyOnceWith(el)
    offB()
    expect(remove).toHaveBeenCalledTimes(1)
    doc.change(null)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('reports a change that follows one made while nobody listened', async () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const el = doc.element()
    await fullscreen.enter(el.html)
    const listener = vi.fn()
    fullscreen.onChange(listener)
    doc.change(null)
    expect(listener).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('reports each change once, however many events the browser sends', () => {
    const doc = new NativeDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const listener = vi.fn()
    fullscreen.onChange(listener)
    const el = doc.element()
    doc.change(el)
    doc.change(el)
    doc.change(null)
    doc.change(null)
    expect(listener.mock.calls).toEqual([[el], [null]])
  })
})

describe('createWebFullscreen without the Fullscreen API', () => {
  it('reports no support', () => {
    expect(createWebFullscreen(new PlainDocument().doc).supported).toBe(false)
    const disabled = new NativeDocument()
    disabled.fullscreenEnabled = false
    expect(createWebFullscreen(disabled.doc).supported).toBe(false)
  })

  it('shows and hides the overlay with the fallback attribute and reports both changes', async () => {
    const fullscreen = createWebFullscreen(new PlainDocument().doc)
    const changes: (Element | null)[] = []
    fullscreen.onChange((element) => changes.push(element))
    const el = new FakeElement()

    await fullscreen.enter(el.html)
    expect(el.attributes.get(FALLBACK_ATTRIBUTE)).toBe('')
    expect(fullscreen.element).toBe(el)

    await fullscreen.exit()
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    expect(fullscreen.element).toBeNull()
    expect(changes).toEqual([el, null])
  })

  it('toggles the overlay', async () => {
    const fullscreen = createWebFullscreen(new PlainDocument().doc)
    const el = new FakeElement()
    await fullscreen.toggle(el.html)
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
    await fullscreen.toggle(el.html)
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    expect(fullscreen.element).toBeNull()
  })

  it('moves the overlay to another element', async () => {
    const fullscreen = createWebFullscreen(new PlainDocument().doc)
    const first = new FakeElement()
    const second = new FakeElement()
    await fullscreen.enter(first.html)
    await fullscreen.enter(second.html)
    expect(first.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    expect(second.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
    expect(fullscreen.element).toBe(second)
  })

  it('closes the overlay on Esc and keeps that Esc from the rest of the page', async () => {
    const doc = new PlainDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const listener = vi.fn()
    fullscreen.onChange(listener)
    const el = new FakeElement()
    await fullscreen.enter(el.html)
    const page = vi.fn()
    doc.addEventListener('keydown', page)

    const esc = keydown('Escape')
    doc.dispatchEvent(esc)
    expect(esc.defaultPrevented).toBe(true)
    expect(page).not.toHaveBeenCalled()
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(null)

    // Closed: the next Esc belongs to the page again.
    const next = keydown('Escape')
    doc.dispatchEvent(next)
    expect(next.defaultPrevented).toBe(false)
    expect(page).toHaveBeenCalledTimes(1)
  })

  it('lets other keys, and an Esc already handled, through', async () => {
    const doc = new PlainDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    const el = new FakeElement()
    await fullscreen.enter(el.html)
    const page = vi.fn()
    doc.addEventListener('keydown', page)
    doc.dispatchEvent(keydown('f'))
    const handled = keydown('Escape')
    handled.preventDefault()
    doc.dispatchEvent(handled)
    expect(page).toHaveBeenCalledTimes(2)
    expect(fullscreen.element).toBe(el)
  })

  it('forgets an overlaid element that left the page', async () => {
    const fullscreen = createWebFullscreen(new PlainDocument().doc)
    const el = new FakeElement()
    await fullscreen.enter(el.html)
    el.isConnected = false
    expect(fullscreen.element).toBeNull()
    await expect(fullscreen.exit()).resolves.toBeUndefined()
  })

  it('works without any document', async () => {
    const fullscreen = createWebFullscreen(null)
    expect(fullscreen.supported).toBe(false)
    const el = new FakeElement()
    await fullscreen.enter(el.html)
    expect(fullscreen.element).toBe(el)
    await fullscreen.exit()
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
  })
})

/** Safari before 16.4: prefixed API, no promises, outcome reported by events. */
class WebkitDocument extends EventTarget {
  webkitFullscreenEnabled = true
  webkitFullscreenElement: Element | null = null
  outcome: 'grant' | 'refuse' | 'silent' = 'grant'
  readonly webkitExitFullscreen = vi.fn(() => {
    this.webkitFullscreenElement = null
    this.dispatchEvent(new Event('webkitfullscreenchange'))
  })
  element(): FakeElement {
    const el = new FakeElement()
    el.webkitRequestFullscreen = () => {
      // The events arrive asynchronously, as in the browser.
      setTimeout(() => {
        if (this.outcome === 'grant') {
          this.webkitFullscreenElement = el as unknown as Element
          this.dispatchEvent(new Event('webkitfullscreenchange'))
        } else if (this.outcome === 'refuse') {
          this.dispatchEvent(new Event('webkitfullscreenerror'))
        }
      }, 10)
    }
    return el
  }
  get doc(): Document {
    return this as unknown as Document
  }
}

describe('createWebFullscreen with the prefixed WebKit API', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('enters and exits through the prefixed calls', async () => {
    vi.useFakeTimers()
    const doc = new WebkitDocument()
    const fullscreen = createWebFullscreen(doc.doc)
    expect(fullscreen.supported).toBe(true)
    const listener = vi.fn()
    fullscreen.onChange(listener)
    const el = doc.element()
    const entering = fullscreen.enter(el.html)
    await vi.advanceTimersByTimeAsync(10)
    await entering
    expect(fullscreen.element).toBe(el)
    expect(listener).toHaveBeenLastCalledWith(el)
    await fullscreen.exit()
    expect(doc.webkitExitFullscreen).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('falls back to the overlay when refused', async () => {
    vi.useFakeTimers()
    const doc = new WebkitDocument()
    doc.outcome = 'refuse'
    const fullscreen = createWebFullscreen(doc.doc)
    const el = doc.element()
    const entering = fullscreen.enter(el.html)
    await vi.advanceTimersByTimeAsync(10)
    await entering
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
  })

  it('falls back to the overlay when the browser never answers', async () => {
    vi.useFakeTimers()
    const doc = new WebkitDocument()
    doc.outcome = 'silent'
    const fullscreen = createWebFullscreen(doc.doc)
    const el = doc.element()
    const entering = fullscreen.enter(el.html)
    await vi.advanceTimersByTimeAsync(999)
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await entering
    expect(el.hasAttribute(FALLBACK_ATTRIBUTE)).toBe(true)
  })
})
