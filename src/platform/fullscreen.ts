/**
 * Card fullscreen (`F` or the header button). Uses the Fullscreen API where it exists. Where it
 * does not (iPhone Safari), or the browser refuses the request (no user gesture, an iframe without
 * `allow="fullscreen"`), the element gets the {@link FALLBACK_ATTRIBUTE} attribute instead; the app's
 * CSS turns that into a fixed overlay with the same look, and Esc closes it.
 */

/** Set (empty) on the element shown as a fullscreen overlay when the Fullscreen API is unavailable. */
export const FALLBACK_ATTRIBUTE = 'data-fullscreen-fallback'

/** Shows one element fullscreen. */
export interface FullscreenController {
  /** Whether the native Fullscreen API is available. When false, `enter` uses the overlay. */
  readonly supported: boolean
  /** Shows `el` fullscreen, replacing any other fullscreen element. Never rejects. */
  enter(el: HTMLElement): Promise<void>
  /** Leaves fullscreen, native or overlay. A no-op when nothing is fullscreen. Never rejects. */
  exit(): Promise<void>
  /**
   * The fullscreen button and the `F` key: leaves fullscreen when `el` is the fullscreen element,
   * else shows `el` fullscreen. Never rejects.
   */
  toggle(el: HTMLElement): Promise<void>
  /**
   * The element shown fullscreen (native or overlay), or null. An overlaid element that has left
   * the page (its card was deleted) no longer counts.
   */
  readonly element: Element | null
  /**
   * Calls `listener` with the new fullscreen element (or null) after every change, including the
   * user leaving native fullscreen with Esc or the browser UI. Returns an unsubscribe function.
   */
  onChange(listener: (element: Element | null) => void): () => void
}

/** Vendor-prefixed members of the Fullscreen API (Safari before 16.4). */
interface PrefixedDocument {
  readonly fullscreenEnabled?: boolean
  readonly fullscreenElement?: Element | null
  exitFullscreen?: () => Promise<void>
  readonly webkitFullscreenEnabled?: boolean
  readonly webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}

interface PrefixedElement {
  requestFullscreen?: () => Promise<void>
  webkitRequestFullscreen?: () => void
}

/** How long a prefixed request may stay unanswered before it counts as refused. */
const PREFIXED_TIMEOUT_MS = 1000

/** At most this many fullscreen elements are left one by one when leaving fullscreen. */
const MAX_EXITS = 16

/** The native API, standard or prefixed. */
interface NativeApi {
  request(el: HTMLElement): Promise<void>
  exit(): Promise<void>
  element(): Element | null
  readonly changeEvent: string
}

function detectNativeApi(doc: Document): NativeApi | null {
  const d = doc as Document & PrefixedDocument
  if (d.fullscreenEnabled === true && typeof d.exitFullscreen === 'function') {
    return {
      request: async (el) => {
        const target = el as HTMLElement & PrefixedElement
        if (typeof target.requestFullscreen !== 'function') throw new Error('no requestFullscreen')
        await target.requestFullscreen()
      },
      exit: async () => {
        // Switching from one element to another stacks them, and exitFullscreen() leaves only the
        // top one, showing the one below again; keep leaving until nothing is fullscreen.
        for (let i = 0; i < MAX_EXITS && doc.fullscreenElement; i++) await doc.exitFullscreen()
      },
      element: () => doc.fullscreenElement ?? null,
      changeEvent: 'fullscreenchange',
    }
  }
  if (d.webkitFullscreenEnabled === true && typeof d.webkitExitFullscreen === 'function') {
    return {
      request: (el) =>
        new Promise<void>((resolve, reject) => {
          const target = el as HTMLElement & PrefixedElement
          if (typeof target.webkitRequestFullscreen !== 'function') {
            reject(new Error('no webkitRequestFullscreen'))
            return
          }
          // The prefixed API returns nothing; the outcome arrives as a change or error event. If
          // neither arrives, check after a second rather than wait forever.
          const settle = (event: Event | null): void => {
            clearTimeout(timeout)
            doc.removeEventListener('webkitfullscreenchange', settle)
            doc.removeEventListener('webkitfullscreenerror', settle)
            const entered = event ? event.type === 'webkitfullscreenchange' : null
            if (entered ?? d.webkitFullscreenElement === el) resolve()
            else reject(new Error('fullscreen refused'))
          }
          const timeout = setTimeout(() => {
            settle(null)
          }, PREFIXED_TIMEOUT_MS)
          doc.addEventListener('webkitfullscreenchange', settle)
          doc.addEventListener('webkitfullscreenerror', settle)
          target.webkitRequestFullscreen()
        }),
      exit: () => {
        d.webkitExitFullscreen?.()
        return Promise.resolve()
      },
      element: () => d.webkitFullscreenElement ?? null,
      changeEvent: 'webkitfullscreenchange',
    }
  }
  return null
}

/**
 * Creates the web fullscreen controller for `doc` (the page's document by default). Without a
 * document (null: tests, workers) it only toggles the overlay attribute.
 */
export function createWebFullscreen(
  doc: Document | null = (globalThis as { document?: Document }).document ?? null,
): FullscreenController {
  const native = doc ? detectNativeApi(doc) : null
  const listeners = new Set<(element: Element | null) => void>()
  let overlay: HTMLElement | null = null
  let notified: Element | null = native?.element() ?? null

  function current(): Element | null {
    if (overlay && !overlay.isConnected) {
      // The overlaid element left the page (its card was deleted): nothing is fullscreen now.
      clearOverlay()
    }
    return native?.element() ?? overlay
  }

  /** Tells listeners about a new fullscreen element; a repeated report of the same one is dropped. */
  function notify(): void {
    const element = current()
    if (element === notified) return
    notified = element
    for (const listener of [...listeners]) listener(element)
  }

  function onNativeChange(): void {
    notify()
  }

  /** Esc closes the overlay, as it does native fullscreen, and the page does not see that Esc. */
  function onKeydown(event: Event): void {
    if ((event as KeyboardEvent).key !== 'Escape' || !overlay || event.defaultPrevented) return
    event.preventDefault()
    event.stopImmediatePropagation()
    clearOverlay()
    notify()
  }

  function clearOverlay(): void {
    if (!overlay) return
    overlay.removeAttribute(FALLBACK_ATTRIBUTE)
    overlay = null
    doc?.removeEventListener('keydown', onKeydown, { capture: true })
  }

  function showOverlay(el: HTMLElement): void {
    if (overlay === el) return
    clearOverlay()
    overlay = el
    el.setAttribute(FALLBACK_ATTRIBUTE, '')
    // Capture on the document runs before the app's window-level key handler.
    doc?.addEventListener('keydown', onKeydown, { capture: true })
    notify()
  }

  async function exitNative(): Promise<void> {
    if (!native?.element()) return
    try {
      await native.exit()
    } catch {
      // Already leaving fullscreen.
    }
  }

  async function enter(el: HTMLElement): Promise<void> {
    if (current() === el) return
    if (native) {
      // Quietly: the native change event, or showOverlay below, reports the new element.
      clearOverlay()
      try {
        await native.request(el)
        return
      } catch {
        // Refused (no user gesture, iframe policy) or unavailable for this element: use the overlay.
      }
      // Another element in native fullscreen would cover the overlay, so leave it first.
      await exitNative()
    }
    showOverlay(el)
  }

  async function exit(): Promise<void> {
    if (overlay) {
      clearOverlay()
      notify()
    }
    await exitNative()
  }

  return {
    supported: native !== null,
    enter,
    exit,

    toggle(el) {
      return current() === el ? exit() : enter(el)
    },

    get element() {
      return current()
    },

    onChange(listener) {
      if (listeners.size === 0) {
        // Native changes went unobserved while nobody listened: start from the current state.
        notified = current()
        if (native) doc?.addEventListener(native.changeEvent, onNativeChange)
      }
      listeners.add(listener)
      return () => {
        if (!listeners.delete(listener)) return
        if (listeners.size === 0 && native) {
          doc?.removeEventListener(native.changeEvent, onNativeChange)
        }
      }
    },
  }
}
