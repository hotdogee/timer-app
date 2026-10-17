/**
 * The platform layer: every browser and OS service the app uses, behind small interfaces
 * (tech-stack.md › Principles, "Platform features sit behind interfaces"). Nothing outside
 * `src/platform` touches `Notification`, `AudioContext`, `Worker`, the Fullscreen API or
 * `crypto.randomUUID` directly.
 *
 * Every piece has a web implementation, used in browsers and, until M5, in the Tauri webview too.
 * M5 swaps in Tauri implementations piece by piece in {@link createPlatform}, by feature detection.
 * Importing this module has no side effects beyond creating plain objects: audio contexts, the
 * wake worker and DOM listeners are created on first use, so it also loads under Node (tests).
 */
import { webAccent, type AccentSource } from './accent'
import { createWebAlarmPlayer, type AlarmPlayer } from './audio'
import { createWebFullscreen, type FullscreenController } from './fullscreen'
import { createIdSource, type IdSource } from './ids'
import { createWebNotifier, type Notifier } from './notifications'
import { createWebWakeScheduler, type WakeScheduler } from './wake'

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
export type {
  NotificationHandle,
  NotificationPermissionState,
  NotificationRequest,
  Notifier,
} from './notifications'
export type { WakeScheduler } from './wake'

/** Which shell hosts the app. */
export type PlatformKind = 'web' | 'tauri'

/** The services the app gets from its host. */
export interface Platform {
  /**
   * The host shell. Individual services may still be web implementations inside Tauri (all of them
   * are until M5), so check a service's own `supported` flag, not this, before relying on it.
   */
  readonly kind: PlatformKind
  readonly accent: AccentSource
  readonly notifications: Notifier
  readonly audio: AlarmPlayer
  readonly wake: WakeScheduler
  readonly ids: IdSource
  readonly fullscreen: FullscreenController
}

/** Detects the Tauri webview by the `isTauri` global it injects, as `@tauri-apps/api` does. */
export function detectKind(scope: object = globalThis): PlatformKind {
  return (scope as { isTauri?: unknown }).isTauri ? 'tauri' : 'web'
}

/** Builds the platform for the detected shell. Every service is the web implementation for now. */
export function createPlatform(kind: PlatformKind = detectKind()): Platform {
  return {
    kind,
    accent: webAccent,
    notifications: createWebNotifier(),
    audio: createWebAlarmPlayer(),
    wake: createWebWakeScheduler(),
    ids: createIdSource(),
    fullscreen: createWebFullscreen(),
  }
}

/** The app's platform. */
export const platform: Platform = createPlatform()
