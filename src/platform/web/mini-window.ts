/**
 * The web's mini window (spec › Card header, Mini window): a Document Picture-in-Picture window,
 * which floats above every other window (Chrome and Edge 116+ on desktop; elsewhere the API is
 * missing and the controller is unsupported, so the UI hides the button).
 *
 * The window starts as an empty document. Before the card is drawn the app's look is copied into
 * it, and kept in step for as long as it is open: every stylesheet of the opener's `<head>` (the
 * app's CSS, the `<style id="theme">` color theme, the color-scheme meta) and the attributes of
 * its `<html>` that carry the appearance and the language (`lang`, `data-theme`, `data-density`,
 * the font and size custom properties in `style`). The card itself is drawn by the UI's `render`
 * callback, since the platform layer cannot import components; it runs inside the
 * Picture-in-Picture document, against the same app state as the main window.
 *
 * However the window closes (its own close button, {@link MiniWindowController.close}, the tab
 * going away), its `pagehide` runs the render's cleanup and the listeners hear `false`. The code
 * for an open window (`mini-window-session.ts`) loads while the browser opens the first one.
 */
import type { MiniWindowController, MiniWindowRender } from '../types'
import type * as SessionModule from './mini-window-session'
import type { MiniWindowSession } from './mini-window-session'

/** The part of the Document Picture-in-Picture API (`window.documentPictureInPicture`) used here. */
export interface DocumentPictureInPictureLike {
  requestWindow(options?: { width?: number; height?: number }): Promise<PictureInPictureWindow>
}

/** The part of a Picture-in-Picture `Window` used here. */
export interface PictureInPictureWindow {
  readonly document: Document
  addEventListener(type: 'pagehide', listener: () => void, options?: { once?: boolean }): void
  close(): void
  focus(): void
}

/** The part of the opener's `window` used here. */
export interface PictureInPictureScope {
  readonly documentPictureInPicture?: DocumentPictureInPictureLike | undefined
  readonly document?: Document | undefined
}

/** The size the mini window opens at, in CSS pixels (the desktop's mini window's first size). */
export const MINI_WINDOW_SIZE: { readonly width: number; readonly height: number } = Object.freeze({
  width: 320,
  height: 200,
})

/** The class of the element the card is drawn into, the only child of the window's `<body>`. */
export const MINI_WINDOW_ROOT_CLASS = 'mini-window'

/**
 * The Document Picture-in-Picture mini window of `scope` (the page's `window` by default),
 * unsupported where the API is missing. Free of side effects until it is opened.
 */
export function createWebMiniWindow(
  scope: PictureInPictureScope = globalThis,
): MiniWindowController {
  const picture = scope.documentPictureInPicture
  const opener = scope.document
  const supported = typeof picture?.requestWindow === 'function' && opener !== undefined
  const listeners = new Set<(open: boolean) => void>()
  let open: {
    readonly window: PictureInPictureWindow
    readonly session: MiniWindowSession
  } | null = null
  let opening: Promise<void> | null = null

  const notify = (next: boolean): void => {
    for (const listener of [...listeners]) listener(next)
  }

  async function request(cardId: string, render: MiniWindowRender): Promise<void> {
    if (picture === undefined || opener === undefined) return
    const code = import('./mini-window-session')
    let window: PictureInPictureWindow
    try {
      // Asked for at once, inside the user gesture the browser requires; the code loads meanwhile.
      window = await picture.requestWindow({ ...MINI_WINDOW_SIZE })
    } catch (error) {
      code.catch(() => undefined)
      console.warn('Timer App: could not open the mini window', error)
      return
    }
    let startSession: typeof SessionModule.startSession
    try {
      ;({ startSession } = await code)
    } catch (error) {
      console.warn('Timer App: could not open the mini window', error)
      window.close()
      return
    }
    const session = startSession(window, opener, () => {
      if (open?.session !== session) return
      open = null
      notify(false)
    })
    open = { window, session }
    session.draw(cardId, render)
    notify(true)
  }

  return {
    supported,
    isOpen: () => open !== null,
    async open(cardId, render) {
      if (!supported) return
      // A second click while the window is still opening switches the card once it is open.
      if (opening !== null) await opening
      if (open !== null) {
        open.session.draw(cardId, render)
        try {
          open.window.focus()
        } catch {
          // Focus is a courtesy.
        }
        return
      }
      const pending = request(cardId, render)
      opening = pending
      try {
        await pending
      } finally {
        if (opening === pending) opening = null
      }
    },
    close() {
      const current = open
      if (current !== null) {
        open = null
        current.session.end()
        notify(false)
        try {
          current.window.close()
        } catch {
          // Closed already.
        }
      }
      return Promise.resolve()
    },
    // A Picture-in-Picture window always floats above the others.
    setAlwaysOnTop: () => Promise.resolve(),
    onChange(listener) {
      const entry = (next: boolean): void => {
        listener(next)
      }
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
  }
}
