/**
 * The desktop services' interfaces (M5): the mini window, global hotkeys, launch at login, the
 * updater, activity reporting to the shell, and opening URLs in the system browser. Each has a web
 * implementation in `index.ts` (unsupported or a plain browser call) and a Tauri one in
 * `tauri/`, loaded through dynamic `import()` on first use, so the web bundle ships no Tauri code.
 *
 * As everywhere in `src/platform`, a service says whether it is `supported`, and its promises
 * never reject: a failed call logs one `console.warn` and resolves to the "nothing happened" value
 * the method documents. A desktop service whose shell code fails to load, or whose plugin fails in
 * a way that will not get better, turns itself off: `supported` reads false from then on, so the
 * UI hides or disables its controls the next time it draws them.
 */
import type { CloseBehavior, HotkeyId } from '../core/settings'

export type { CloseBehavior, HotkeyId } from '../core/settings'

/**
 * Draws card `cardId` into `target`, an element in another window (the web's Document
 * Picture-in-Picture window), and returns the function that removes it again. Supplied by the UI,
 * since the platform layer cannot import components.
 */
export type MiniWindowRender = (target: HTMLElement, cardId: string) => () => void

/** How a mini window opens. */
export interface MiniWindowOptions {
  /** Whether it floats above other apps (Settings › Desktop); defaults to true. Tauri only. */
  readonly alwaysOnTop?: boolean
}

/**
 * The always-on-top mini window that shows one card (spec › Card header, Mini window). Desktop
 * opens a Tauri window that renders the `/mini?card=<id>` page itself; the web opens a Document
 * Picture-in-Picture window (Chromium 116+) and mounts the card there through the `render`
 * callback. At most one mini window is open.
 */
export interface MiniWindowController {
  /** Whether this platform can open a mini window, known up front (the UI hides the button). */
  readonly supported: boolean
  /** Whether the mini window is open now. */
  isOpen(): boolean
  /**
   * Opens the mini window on card `cardId`, or switches the open one to that card and focuses it.
   * Call it from a user gesture (the web's Picture-in-Picture needs one). Resolves once the window
   * is open, or at once when unsupported or it failed. Never rejects.
   */
  open(cardId: string, render: MiniWindowRender, options?: MiniWindowOptions): Promise<void>
  /** Closes the mini window if it is open. Never rejects. */
  close(): Promise<void>
  /** Makes the open mini window float above other apps or not; a no-op where unsupported. */
  setAlwaysOnTop(alwaysOnTop: boolean): Promise<void>
  /**
   * Calls `listener` whenever the mini window opens (`true`) or closes (`false`), however it was
   * closed. Returns the function that unsubscribes.
   */
  onChange(listener: (open: boolean) => void): () => void
}

/**
 * What binding a global hotkey came to:
 * - `ok`: bound (or unbound, for a null combo);
 * - `taken`: another app (or the OS) already holds this combo;
 * - `invalid`: the combo has no global-shortcut equivalent (a key the OS cannot register);
 * - `unsupported`: this platform has no global hotkeys (the web).
 */
export type HotkeyResult = 'ok' | 'taken' | 'invalid' | 'unsupported'

/** Every {@link HotkeyResult}, e.g. to check that each has a message. */
export const HOTKEY_RESULTS: readonly HotkeyResult[] = Object.freeze([
  'ok',
  'taken',
  'invalid',
  'unsupported',
])

/** System-wide hotkeys that work while another app has the focus (desktop only). */
export interface GlobalHotkeys {
  readonly supported: boolean
  /**
   * Binds hotkey `id` to `combo`, in the keymap's portable binding text (`'Mod+Shift+Space'`;
   * `Mod` is Cmd on macOS and Ctrl elsewhere), first releasing the combo it had. A null combo only
   * releases it. On anything but `'ok'` the hotkey is left unbound; an error the OS gives for one
   * combo is `'invalid'` (with a warning) and leaves the other hotkeys working. Never rejects.
   */
  set(id: HotkeyId, combo: string | null): Promise<HotkeyResult>
  /**
   * Calls `listener` each time a bound hotkey is pressed (key down only; holding it does not
   * repeat). `showApp` is also handled by the platform itself, before the listeners run: it shows
   * and focuses the main window, or hides it when it already has the focus. Returns the function
   * that unsubscribes.
   */
  onPressed(listener: (id: HotkeyId) => void): () => void
}

/** Launch at login (desktop only): the OS starts the app, hidden to the tray, at login. */
export interface Autostart {
  /** Whether launch at login can be changed here; false on the web, and once the plugin failed. */
  readonly supported: boolean
  /**
   * Whether the OS will start the app at login, or null when that is not known (unsupported, or
   * the OS could not be asked). Never rejects.
   */
  isEnabled(): Promise<boolean | null>
  /**
   * Turns launch at login on or off and resolves to whether it is on afterwards, read back from
   * the OS. A change the OS refuses, or that fails, resolves to the state before it, `!enabled`
   * (the plugin is then off: `supported` reads false). False when unsupported. Never rejects.
   */
  setEnabled(enabled: boolean): Promise<boolean>
}

/** An update the updater found. */
export interface UpdateInfo {
  /** The new version, e.g. `1.2.0`. */
  readonly version: string
  /** The running version. */
  readonly currentVersion: string
  /** The release notes, or null when the release has none. */
  readonly notes: string | null
  /** When the update was published (RFC 3339), or null when unknown. */
  readonly date: string | null
}

/**
 * What a check for updates found: the update, null for none, or `'failed'` when the check did not
 * get an answer (offline, the server down, a manifest that does not parse).
 */
export type UpdateCheck = UpdateInfo | null | 'failed'

/** How far an update's download has come, in bytes. */
export interface UpdateProgress {
  readonly downloaded: number
  /** The download's size, or null when the server did not say. */
  readonly total: number | null
}

/**
 * The desktop app's self-update (Tauri updater with signed update manifests). Builds without the
 * signing key (until M6) are not configured: they never find an update.
 */
export interface Updater {
  /** Whether this platform can update itself at all: the desktop app. False on the web. */
  readonly supported: boolean
  /**
   * Whether this build can check for updates: it carries the updater's public key (M6). False on
   * the web and in builds without the key. Never rejects.
   */
  configured(): Promise<boolean>
  /**
   * Asks the update server for a newer version. Resolves to it, to null when there is none or the
   * build is not configured, or to `'failed'` when the check failed (one `console.warn`; the next
   * check tries again). Never rejects.
   */
  check(): Promise<UpdateCheck>
  /**
   * Downloads and installs the update the last {@link check} found, reporting progress. Resolves
   * to true once it is installed (then call {@link restart}), or to false when there is none or
   * it failed (one `console.warn`). On Windows the installer quits the app while it installs, so
   * the promise may never resolve there. Never rejects.
   */
  install(onProgress?: (progress: UpdateProgress) => void): Promise<boolean>
  /** Restarts the app, into the installed update. Never rejects. */
  restart(): Promise<void>
}

/**
 * What the app tells the desktop shell about itself, and what the shell asks of the app. The
 * shell decides on its own what closing the main window does (see {@link CloseBehavior}), so it
 * must always know whether a timer is running and what the setting says.
 */
export interface ActivityReporter {
  /** Whether a shell is listening (the desktop app). On the web every method does nothing. */
  readonly supported: boolean
  /**
   * Reports whether any card is running or ringing. Call it on every change; repeating the same
   * value sends nothing.
   */
  setRunning(running: boolean): void
  /** Reports the close behavior setting. Call it at startup and on every change, as above. */
  setCloseBehavior(behavior: CloseBehavior): void
  /**
   * Calls `listener` when the tray menu's "Start or pause the last card" is chosen; it should do
   * what the `toggleLast` hotkey does. Returns the function that unsubscribes.
   */
  onToggleLast(listener: () => void): () => void
}

/** Opens web pages in the system browser (the desktop sign-in opens the `/device` page with it). */
export interface Opener {
  readonly supported: boolean
  /**
   * Opens `url` in the system browser (the web: a new tab) and resolves to whether it was handed
   * over. Only `http:` and `https:` URLs open; anything else resolves to false with one
   * `console.warn`, as does a URL the desktop app may not open (its capability scope) or a failed
   * call. A refused URL does not turn the opener off. Never rejects.
   */
  open(url: string): Promise<boolean>
}
