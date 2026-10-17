/**
 * The web app's service worker (spec › Persistence and instances: an installable PWA that works
 * offline, and a new version shows an "Update ready" snackbar with Reload). vite-plugin-pwa builds
 * the worker, which precaches the whole app; this module registers it and tells the UI what
 * happened through {@link pwaState}. The app's snackbars read it; {@link applyUpdate} is their
 * Reload action.
 *
 * Registration is skipped inside Tauri (the installer carries the app and the updater replaces it),
 * under `vite dev` (no worker is built there), and where the browser has no service workers.
 * Importing the module has no side effects, and the registration code (`virtual:pwa-register` and
 * workbox-window) loads only when {@link registerPwa} runs, so the module also loads under Node.
 */
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'

import { platform, type PlatformKind } from './platform'

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
