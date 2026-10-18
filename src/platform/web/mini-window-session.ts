/**
 * An open Document Picture-in-Picture mini window (see `mini-window.ts`, which loads this module
 * while the browser opens the window): the app's look copied into the window and kept in step,
 * and the card drawn into it.
 */
import type { MiniWindowRender } from '../types'
import { MINI_WINDOW_ROOT_CLASS, type PictureInPictureWindow } from './mini-window'

/** What of the opener's `<head>` the window copies: stylesheets and the color-scheme meta. */
const HEAD_SELECTOR = 'style, link[rel~="stylesheet"], meta[name="color-scheme"]'

/** The opener's `<html>` attributes the window copies (the appearance and the language). */
const ROOT_ATTRIBUTES = ['lang', 'dir', 'class', 'style', 'data-theme', 'data-density']

/**
 * A copy of `source` (from the opener's `<head>`) for document `to`: a `<link>` keeps its
 * absolute URL (the window's document resolves relative ones against another URL), a `<style>`
 * its text and id.
 */
function copyOf(source: Element, to: Document): Element {
  if (source.localName === 'link') {
    const link = to.createElement('link')
    link.rel = 'stylesheet'
    link.href = (source as HTMLLinkElement).href
    const media = source.getAttribute('media')
    if (media !== null) link.media = media
    return link
  }
  const copy = to.importNode(source, false)
  copy.textContent = source.textContent
  return copy
}

/**
 * Keeps `to`'s head copies and root attributes the same as `from`'s, now and on every change
 * (a new theme, a lazily loaded stylesheet, another language). Returns the function that stops.
 */
function mirror(from: Document, to: Document): () => void {
  const copies = new Map<Element, Element>()
  const syncHead = (): void => {
    const current = new Set(from.head.querySelectorAll(HEAD_SELECTOR))
    for (const [source, copy] of copies) {
      if (current.has(source)) continue
      copy.remove()
      copies.delete(source)
    }
    for (const source of current) {
      const copy = copies.get(source)
      if (copy === undefined) {
        const created = copyOf(source, to)
        to.head.append(created)
        copies.set(source, created)
      } else if (source.localName === 'style' && copy.textContent !== source.textContent) {
        copy.textContent = source.textContent
      }
    }
  }
  const syncRoot = (): void => {
    for (const name of ROOT_ATTRIBUTES) {
      const value = from.documentElement.getAttribute(name)
      if (value === null) to.documentElement.removeAttribute(name)
      else if (to.documentElement.getAttribute(name) !== value) {
        to.documentElement.setAttribute(name, value)
      }
    }
  }
  syncHead()
  syncRoot()
  // The head only: observing the whole document would wake up for every digit the cards draw.
  const head = new MutationObserver(syncHead)
  head.observe(from.head, { childList: true, subtree: true, characterData: true })
  const root = new MutationObserver(syncRoot)
  root.observe(from.documentElement, { attributes: true, attributeFilter: ROOT_ATTRIBUTES })
  return () => {
    head.disconnect()
    root.disconnect()
  }
}

/** An open mini window. */
export interface MiniWindowSession {
  /** Draws card `cardId` in the window, in place of the one it shows. */
  draw(cardId: string, render: MiniWindowRender): void
  /** Removes the card and stops copying the opener's look. Idempotent. */
  end(): void
}

/**
 * Sets up `window`, which just opened: copies `from`'s look into it (and keeps it in step) and
 * makes the element the card is drawn into. When the window goes away by itself (its own close
 * button, the tab closing), its `pagehide` ends the session and calls `onEnd`; after {@link
 * MiniWindowSession.end} it does not.
 */
export function startSession(
  window: PictureInPictureWindow,
  from: Document,
  onEnd: () => void,
): MiniWindowSession {
  const doc = window.document
  const stopMirror = mirror(from, doc)
  doc.title = from.title
  const target = doc.createElement('div')
  target.className = MINI_WINDOW_ROOT_CLASS
  doc.body.replaceChildren(target)
  let cleanup: (() => void) | null = null
  let ended = false

  const clear = (): void => {
    const previous = cleanup
    cleanup = null
    try {
      previous?.()
    } catch (error) {
      console.warn('Timer App: could not remove the card from the mini window', error)
    }
    target.replaceChildren()
  }

  const session: MiniWindowSession = {
    draw(cardId, render) {
      if (ended) return
      clear()
      try {
        cleanup = render(target, cardId)
      } catch (error) {
        console.warn('Timer App: could not show the card in the mini window', error)
      }
    },
    end() {
      if (ended) return
      ended = true
      stopMirror()
      clear()
    },
  }
  window.addEventListener(
    'pagehide',
    () => {
      if (ended) return
      session.end()
      onEnd()
    },
    { once: true },
  )
  return session
}
