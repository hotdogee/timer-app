/**
 * The app's updates. On the web, the service worker (spec › Persistence and instances: an
 * installable PWA that works offline, and a new version shows an "Update ready" snackbar with
 * Reload): vite-plugin-pwa builds the worker, which precaches the whole app; this module
 * registers it and tells the UI what happened through {@link pwaState}. The app's snackbars read
 * it; {@link applyUpdate} is their Reload action. On desktop, the updater ({@link desktopUpdates},
 * at the end): it checks 10 s after launch and every 6 hours, and the same state feeds the update
 * prompt (`ui/UpdatePrompt.svelte`) and Settings › About's updates row.
 *
 * Registration is skipped inside Tauri (the installer carries the app and the updater replaces it),
 * under `vite dev` (no worker is built there), and where the browser has no service workers. A web
 * build (`__DESKTOP__` false) leaves the desktop half out.
 * Importing the module has no side effects, and the registration code (`virtual:pwa-register` and
 * workbox-window) loads only when {@link registerPwa} runs, so the module also loads under Node.
 */
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

import { platform, type PlatformKind, type UpdateInfo, type Updater } from './platform'

/**
 * `registerSW` from `virtual:pwa-register`: registers the worker and returns a function that
 * activates the waiting worker; the page reloads once that worker controls it.
 */
export type RegisterServiceWorker = (
  options: RegisterSWOptions,
) => (reloadPage?: boolean) => Promise<void>

/** What the service worker has done, for the UI. Both flags are reactive. */
export interface PwaState {
  /**
   * A new version is installed and waiting for this page to let it take over. {@link Pwa.applyUpdate}
   * switches to it and reloads the page.
   */
  readonly updateReady: boolean
  /** The app has just been cached for offline use: true after the first install only. */
  readonly offlineReady: boolean
}

/** Overrides for {@link createPwa}. Each one is read when `register()` runs. */
export interface PwaOptions {
  /** The host shell; Tauri skips registration. Defaults to `platform.kind`. */
  readonly kind?: PlatformKind
  /** True under `vite dev`, which builds no worker; skips registration. Defaults to `import.meta.env.DEV`. */
  readonly dev?: boolean
  /** Whether the browser has service workers. Defaults to `'serviceWorker' in navigator`. */
  readonly supported?: boolean
  /** Loads `registerSW`. Defaults to a dynamic import of `virtual:pwa-register`. */
  readonly load?: () => Promise<RegisterServiceWorker>
}

/** The service worker registration and its state. */
export interface Pwa {
  readonly state: PwaState
  /**
   * Registers the service worker, at most once. Resolves to true when this call started the
   * registration and false when it was skipped (Tauri, dev, no service workers, already started,
   * or the registration code failed to load). Never throws; failures are logged as warnings.
   */
  register(): Promise<boolean>
  /** Activates the waiting version; the page reloads into it. Does nothing before registration. */
  applyUpdate(): Promise<void>
  /** Clears `updateReady` (the user closed the prompt). A later update sets it again. */
  dismissUpdate(): void
  /** Clears `offlineReady` once its message has been shown. */
  dismissOfflineReady(): void
}

const loadRegisterSW = async (): Promise<RegisterServiceWorker> =>
  (await import('virtual:pwa-register')).registerSW

function hasServiceWorkers(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator
}

function warn(message: string, error: unknown): void {
  console.warn(`Timer App: ${message}`, error)
}

/** Creates a service worker controller. The app uses the singleton below; tests make their own. */
export function createPwa(options: PwaOptions = {}): Pwa {
  let updateReady = $state(false)
  let offlineReady = $state(false)
  let started = false
  let update: ((reloadPage?: boolean) => Promise<void>) | undefined

  return {
    state: {
      get updateReady() {
        return updateReady
      },
      get offlineReady() {
        return offlineReady
      },
    },

    async register() {
      const kind = options.kind ?? platform.kind
      const dev = options.dev ?? import.meta.env.DEV
      const supported = options.supported ?? hasServiceWorkers()
      if (started || kind === 'tauri' || dev || !supported) return false
      started = true
      let registerSW: RegisterServiceWorker
      try {
        registerSW = await (options.load ?? loadRegisterSW)()
      } catch (error) {
        warn('could not load the service worker registration', error)
        return false
      }
      update = registerSW({
        immediate: true,
        onNeedRefresh: () => {
          updateReady = true
        },
        onOfflineReady: () => {
          offlineReady = true
        },
        onRegisterError: (error: unknown) => {
          warn('could not register the service worker', error)
        },
      })
      return true
    },

    async applyUpdate() {
      await update?.()
    },

    dismissUpdate() {
      updateReady = false
    },

    dismissOfflineReady() {
      offlineReady = false
    },
  }
}

const pwa = createPwa()

/** The app's service worker state. Reactive; see {@link PwaState}. */
export const pwaState: PwaState = pwa.state

/**
 * Registers the app's service worker, once; main.ts calls it after the app has mounted. Skipped in
 * Tauri, under `vite dev` and without service worker support. See {@link Pwa.register}.
 */
export function registerPwa(): Promise<boolean> {
  return pwa.register()
}

/** Switches to the waiting version and reloads: the "Update ready" snackbar's Reload action. */
export function applyUpdate(): Promise<void> {
  return pwa.applyUpdate()
}

/** Hides "Update ready" until the next update (the snackbar was closed without reloading). */
export function dismissUpdate(): void {
  pwa.dismissUpdate()
}

/** Hides "Ready to work offline" once the snackbar has shown it. */
export function dismissOfflineReady(): void {
  pwa.dismissOfflineReady()
}

// ── Desktop updates ──────────────────────────────────────────────────────────────────────────

/**
 * Where the desktop app's self-update stands:
 * - `idle`: not checked yet;
 * - `unconfigured`: this build cannot update itself (it has no updater key yet);
 * - `checking`, then `none` (no update found), `check-failed` (the check got no answer: the
 *   server is down, say), `offline` (not checked: no connection) or `available` (`info` is the
 *   update);
 * - `downloading` (`progress`), `installing`, `restarting`: Install and restart was chosen;
 * - `failed`: installing failed; `info` is still the update, to try again.
 */
export type DesktopUpdatePhase =
  | 'idle'
  | 'unconfigured'
  | 'checking'
  | 'none'
  | 'check-failed'
  | 'offline'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'restarting'
  | 'failed'

/** The desktop updater's state and actions. Every getter is reactive. Nothing here rejects. */
export interface DesktopUpdates {
  /** Whether the app can update itself at all (the desktop app; false on the web). */
  readonly supported: boolean
  readonly phase: DesktopUpdatePhase
  /** The update found by the last check, or null. */
  readonly info: UpdateInfo | null
  /** How much of the update is downloaded, 0 to 1, or null when the size is unknown. */
  readonly progress: number | null
  /**
   * Whether the update prompt should show: an update is available that was not put off with
   * Later, or one is being installed or failed to install.
   */
  readonly prompt: boolean
  /** Finds out whether this build can update itself (`unconfigured` when not). */
  init(): Promise<void>
  /** Checks for an update now, unless a check or an install is under way. */
  check(): Promise<void>
  /** Downloads and installs the update found, then restarts the app into it. */
  install(): Promise<void>
  /** Puts the update found off: the prompt waits for a newer version (About still offers it). */
  later(): void
  /**
   * Checks after `firstDelayMs` and then every `everyMs` while running (unconfigured builds
   * never check, and none checks while an update is on offer). Returns the function that stops.
   */
  schedule(firstDelayMs?: number, everyMs?: number): () => void
}

/** When the desktop app first checks for an update after launch. */
export const UPDATE_FIRST_CHECK_MS = 10_000

/** How often the desktop app checks for an update while it runs. */
export const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** What {@link createDesktopUpdates} needs besides the updater; every field has a default. */
export interface DesktopUpdatesOptions {
  /** Whether the device is online; `navigator.onLine` by default (true where unknown). */
  readonly online?: () => boolean
}

function browserOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

/** Creates the desktop update state over `updater`. The app uses {@link desktopUpdates}. */
export function createDesktopUpdates(
  updater: Updater,
  options: DesktopUpdatesOptions = {},
): DesktopUpdates {
  const online = options.online ?? browserOnline
  let phase = $state<DesktopUpdatePhase>('idle')
  let info = $state.raw<UpdateInfo | null>(null)
  let progress = $state<number | null>(null)
  /** The version put off with Later. */
  let dismissed = $state<string | null>(null)
  let configured: Promise<boolean> | null = null

  function busy(): boolean {
    return (
      phase === 'checking' ||
      phase === 'downloading' ||
      phase === 'installing' ||
      phase === 'restarting'
    )
  }

  async function isConfigured(): Promise<boolean> {
    if (!updater.supported) return false
    configured ??= updater.configured()
    const answer = await configured
    if (!answer) phase = 'unconfigured'
    return answer
  }

  async function check(): Promise<void> {
    if (busy() || !(await isConfigured()) || busy()) return
    if (!online()) {
      phase = 'offline'
      return
    }
    phase = 'checking'
    const found = await updater.check()
    if (found === 'failed') {
      phase = 'check-failed'
      return
    }
    info = found
    phase = found === null ? 'none' : 'available'
  }

  return {
    supported: updater.supported,
    get phase() {
      return phase
    },
    get info() {
      return info
    },
    get progress() {
      return progress
    },
    get prompt() {
      switch (phase) {
        case 'available':
          return info !== null && info.version !== dismissed
        case 'downloading':
        case 'installing':
        case 'restarting':
        case 'failed':
          return true
        default:
          return false
      }
    },

    async init() {
      await isConfigured()
    },

    check,

    async install() {
      if (info === null || (phase !== 'available' && phase !== 'failed')) return
      phase = 'downloading'
      progress = null
      const installed = await updater.install(({ downloaded, total }) => {
        if (total === null || total <= 0) return
        progress = Math.min(1, Math.max(0, downloaded / total))
        if (downloaded >= total) phase = 'installing'
      })
      if (!installed) {
        phase = 'failed'
        return
      }
      phase = 'restarting'
      await updater.restart()
    },

    later() {
      if (info === null) return
      dismissed = info.version
      // A failed install is still on offer (Settings › About), just not in the prompt.
      if (phase === 'failed') phase = 'available'
    },

    schedule(firstDelayMs = UPDATE_FIRST_CHECK_MS, everyMs = UPDATE_CHECK_EVERY_MS) {
      if (!updater.supported) return () => undefined
      // An update already on offer stays on offer: checking again would only hide the prompt.
      const tick = (): void => {
        if (phase !== 'available' && phase !== 'failed') void check()
      }
      let every: ReturnType<typeof setInterval> | undefined
      const first = setTimeout(() => {
        tick()
        every = setInterval(tick, everyMs)
      }, firstDelayMs)
      return () => {
        clearTimeout(first)
        clearInterval(every)
      }
    },
  }
}

/** A web build's desktop updates: unsupported, and nothing ever happens. */
const WEB_UPDATES: DesktopUpdates = Object.freeze({
  supported: false,
  phase: 'idle',
  info: null,
  progress: null,
  prompt: false,
  init: () => Promise.resolve(),
  check: () => Promise.resolve(),
  install: () => Promise.resolve(),
  later: () => undefined,
  schedule: () => () => undefined,
})

/**
 * The desktop app's update state (unsupported on the web, where the service worker updates; a
 * web build has only {@link WEB_UPDATES}).
 */
export const desktopUpdates: DesktopUpdates = __DESKTOP__
  ? createDesktopUpdates(platform.updater)
  : WEB_UPDATES

/**
 * Starts the desktop app's update checks (10 s after launch, then every 6 hours); call it once
 * the app has mounted. Does nothing on the web. Returns the function that stops them.
 */
export function startDesktopUpdateChecks(): () => void {
  return desktopUpdates.schedule()
}
