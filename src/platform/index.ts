/**
 * The platform layer: every browser and OS service the app uses, behind small interfaces
 * (tech-stack.md › Principles, "Platform features sit behind interfaces"). Nothing outside
 * `src/platform` touches `Notification`, `AudioContext`, `Worker`, the Fullscreen API or
 * `crypto.randomUUID` directly.
 *
 * Every piece has a web implementation, used in browsers and, where the shell offers nothing
 * better, in the Tauri webview too (audio, the wake worker, fullscreen, ids). The desktop-only
 * services (see `types.ts`) are unsupported no-ops on the web, except the mini window, which is
 * a Document Picture-in-Picture window where the browser has one (`web/mini-window.ts`).
 * {@link createPlatform} picks the Tauri implementations for the Tauri webview
 * (`tauri/services.ts`, and `tauri/token-store.ts` for the sign-in token); they load their shell
 * code through dynamic `import()` on first use. Only desktop builds contain them at all:
 * `__DESKTOP__` (vite.config.ts) is false in a web build, so the bundler leaves them out of it. Importing this module has no side effects beyond creating
 * plain objects: audio contexts, the wake worker and DOM listeners are created on first use, so
 * it also loads under Node (tests).
 */
import { webAccent, type AccentSource } from './accent'
import { createWebAlarmPlayer, type AlarmPlayer } from './audio'
import { createWebFullscreen, type FullscreenController } from './fullscreen'
import { createIdSource, type IdSource } from './ids'
import { createWebNotifier, type Notifier } from './notifications'
import { createTauriServices, type DesktopShell } from './tauri/services'
import { createTauriTokenStore } from './tauri/token-store'
import type {
  ActivityReporter,
  Autostart,
  GlobalHotkeys,
  MiniWindowController,
  Opener,
  TokenStore,
  Updater,
} from './types'
import { createWebWakeScheduler, type WakeScheduler } from './wake'
import { createWebMiniWindow } from './web/mini-window'
import { isWebUrl } from './web/url'

export type { AccentSource } from './accent'
export {
  DEFAULT_SOUND,
  DEFAULT_VOLUME,
  SOUND_IDS,
  unlockAudioOnGestures,
  type AlarmPlayer,
  type PlayOptions,
  type SoundId,
} from './audio'
export { FALLBACK_ATTRIBUTE, type FullscreenController } from './fullscreen'
export type { IdSource } from './ids'
export type { DesktopShell, TrayLabels } from './tauri/services'
export type {
  NotificationHandle,
  NotificationPermissionState,
  NotificationRequest,
  Notifier,
} from './notifications'
export {
  HOTKEY_RESULTS,
  type ActivityReporter,
  type Autostart,
  type CloseBehavior,
  type DeviceAuth,
  type GlobalHotkeys,
  type HotkeyId,
  type HotkeyResult,
  type MiniWindowController,
  type MiniWindowOptions,
  type MiniWindowRender,
  type Opener,
  type TokenStore,
  type UpdateCheck,
  type UpdateInfo,
  type Updater,
  type UpdateProgress,
} from './types'
export type { WakeScheduler } from './wake'
export { createWebMiniWindow } from './web/mini-window'

/** Which shell hosts the app. */
export type PlatformKind = 'web' | 'tauri'

/** The services the app gets from its host. */
export interface Platform {
  /**
   * The host shell. Some services are web implementations inside Tauri too, and a desktop service
   * may be unsupported on one OS, so check a service's own `supported` flag, not this, before
   * relying on it.
   */
  readonly kind: PlatformKind
  readonly accent: AccentSource
  readonly notifications: Notifier
  readonly audio: AlarmPlayer
  readonly wake: WakeScheduler
  readonly ids: IdSource
  readonly fullscreen: FullscreenController
  /** The always-on-top mini window (desktop: a Tauri window; web: Document Picture-in-Picture). */
  readonly windows: MiniWindowController
  /** Global hotkeys (desktop only). */
  readonly hotkeys: GlobalHotkeys
  /** Launch at login (desktop only). */
  readonly autostart: Autostart
  /** Self-update (desktop only). */
  readonly updater: Updater
  /** Running state and close behavior for the shell, and the tray's commands (desktop only). */
  readonly activity: ActivityReporter
  /** Opens URLs in the system browser. */
  readonly opener: Opener
  /** The sign-in token in the OS credential store (desktop only). */
  readonly tokens: TokenStore
  /** The tray menu's labels, the mini window page's card switches, the smoke hook (desktop only). */
  readonly shell: DesktopShell
}

/** Detects the Tauri webview by the `isTauri` global it injects, as `@tauri-apps/api` does. */
export function detectKind(scope: object = globalThis): PlatformKind {
  return (scope as { isTauri?: unknown }).isTauri ? 'tauri' : 'web'
}

/** Does nothing: the web activity reports, and unsubscribing a listener that never runs. */
const noop = (): void => undefined

/** A mini window that does not exist: unsupported, never open, every call a no-op (for tests). */
export const unsupportedMiniWindow: MiniWindowController = Object.freeze({
  supported: false,
  isOpen: () => false,
  open: () => Promise.resolve(),
  close: () => Promise.resolve(),
  setAlwaysOnTop: () => Promise.resolve(),
  onChange: () => noop,
})

/** Global hotkeys on the web: unsupported; binding answers `'unsupported'`, nothing is pressed. */
export const unsupportedHotkeys: GlobalHotkeys = Object.freeze({
  supported: false,
  set: () => Promise.resolve('unsupported' as const),
  onPressed: () => noop,
})

/** Launch at login on the web: unsupported; the state is unknown and never changes. */
export const unsupportedAutostart: Autostart = Object.freeze({
  supported: false,
  isEnabled: () => Promise.resolve(null),
  setEnabled: () => Promise.resolve(false),
})

/** The updater on the web: unsupported (the service worker updates the web app). */
export const unsupportedUpdater: Updater = Object.freeze({
  supported: false,
  configured: () => Promise.resolve(false),
  check: () => Promise.resolve(null),
  install: () => Promise.resolve(false),
  restart: () => Promise.resolve(),
})

/** Activity reporting on the web: there is no shell to tell, and no tray. */
export const webActivity: ActivityReporter = Object.freeze({
  supported: false,
  setRunning: noop,
  setCloseBehavior: noop,
  onToggleLast: () => noop,
})

/** The token store on the web: unsupported (the session cookie needs none); nothing is stored. */
export const unsupportedTokenStore: TokenStore = Object.freeze({
  supported: false,
  get: () => Promise.resolve(null),
  set: () => Promise.resolve(false),
  clear: () => Promise.resolve(false),
})

/** The desktop shell's hooks on the web: there is no tray, no mini window page, no smoke test. */
export const webShell: DesktopShell = Object.freeze({
  supported: false,
  setTrayLabels: noop,
  onMiniCard: () => noop,
  smokeMark: noop,
})

/** The part of `window` the web opener uses. */
export interface OpenerScope {
  open?: (url: string, target: string, features: string) => unknown
}

/**
 * The web opener: `window.open(url, '_blank', 'noopener')`, a new tab that cannot reach back to
 * the app. Unsupported where there is no `window.open` (Node). With `noopener` the browser gives
 * no handle back, so a blocked pop-up still reads as opened.
 */
export function createWebOpener(scope: OpenerScope = globalThis): Opener {
  const supported = typeof scope.open === 'function'
  return {
    supported,
    open(url) {
      if (!supported) return Promise.resolve(false)
      if (!isWebUrl(url)) {
        console.warn('Timer App: not opening a URL that is not http(s):', url)
        return Promise.resolve(false)
      }
      try {
        scope.open?.(url, '_blank', 'noopener')
        return Promise.resolve(true)
      } catch (error) {
        console.warn('Timer App: could not open', url, error)
        return Promise.resolve(false)
      }
    },
  }
}

/**
 * Builds the platform for the detected shell. Synchronous and free of side effects: no service
 * touches the OS or the shell until it is first used. A web build (`__DESKTOP__` false) has no
 * desktop services, so it gets the web ones even inside a Tauri webview.
 */
export function createPlatform(kind: PlatformKind = detectKind()): Platform {
  const shared = {
    audio: createWebAlarmPlayer(),
    wake: createWebWakeScheduler(),
    ids: createIdSource(),
    fullscreen: createWebFullscreen(),
  }
  if (__DESKTOP__ && kind === 'tauri') {
    return { kind, ...shared, ...createTauriServices(), tokens: createTauriTokenStore() }
  }
  return {
    kind,
    ...shared,
    accent: webAccent,
    notifications: createWebNotifier(),
    windows: createWebMiniWindow(),
    hotkeys: unsupportedHotkeys,
    autostart: unsupportedAutostart,
    updater: unsupportedUpdater,
    activity: webActivity,
    opener: createWebOpener(),
    tokens: unsupportedTokenStore,
    shell: webShell,
  }
}

/** The app's platform. */
export const platform: Platform = createPlatform()
