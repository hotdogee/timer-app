/**
 * Alarm orchestration (spec › Time's up): turns the card list into side effects.
 *
 * - Sound: one alarm sound loops while any unmuted timer is ringing and stops when none is.
 * - Notifications: one system notification per ringing card, shown when it starts ringing and
 *   closed when it stops; clicking it focuses the app and dismisses that card.
 * - Background wake: the earliest running deadline is handed to the platform wake scheduler, which
 *   settles the cards on time even in a hidden tab, where animation frames stop.
 * - Gestures: audio is unlocked on every pointer or key gesture, and notification permission is
 *   asked for the first time a timer starts.
 *
 * The decisions live in {@link createAlarmCore}, a plain object driven by `sync(list)` so it can be
 * tested without a DOM; {@link createAlarm} runs it from an effect on the card store.
 */
import { untrack } from 'svelte'

import { cards, timer, type EpochMs } from '../core'
import {
  DEFAULT_SOUND,
  DEFAULT_VOLUME,
  unlockAudioOnGestures,
  type NotificationHandle,
  type Platform,
  type SoundId,
} from '../platform'
import { frameClock } from '../ui/frame-clock.svelte'
import type { CardStore } from './cards.svelte'

/** The card store actions the alarm uses. */
export type AlarmStore = Pick<CardStore, 'list' | 'settle' | 'timer'>

/** The platform services the alarm uses. */
export type AlarmPlatform = Pick<Platform, 'audio' | 'notifications' | 'wake'>

/** Alarm settings; every field has a default. M3 settings will feed these. */
export interface AlarmOptions {
  /** The alarm sound. Defaults to the platform default (chime). */
  readonly sound?: SoundId
  /** Alarm volume, 0 to 1. Defaults to the platform default (0.8). */
  readonly volume?: number
  /** Reads the clock for a wake-up and returns that `now`. Defaults to bumping the frame clock. */
  readonly bump?: () => EpochMs
  /**
   * Where pointer and key gestures unlock audio: the window by default, `null` for nowhere (tests).
   */
  readonly gestureTarget?: EventTarget | null
}

/** The body text of a time's-up notification. */
export const NOTIFICATION_BODY = "Time's up"

/** The alarm's decisions, driven by the card list. */
export interface AlarmCore {
  /** Brings sound, notifications and the wake-up in line with `list`. Call it on every change. */
  sync(list: cards.CardList): void
  /**
   * Call synchronously inside a Start gesture: unlocks audio and, the first time, asks for
   * notification permission (browsers only allow both from a user gesture).
   */
  prime(): void
  /** Stops the sound, closes notifications, cancels the wake-up. Later calls do nothing. */
  dispose(): void
}

/** The running app's alarm. */
export interface Alarm {
  /** See {@link AlarmCore.prime}. */
  prime(): void
  /** Stops watching the store and undoes every effect (sound, notifications, listeners). */
  destroy(): void
}

function frameNow(): EpochMs {
  frameClock.bump()
  return untrack(() => frameClock.now)
}

/** Whether some timer in `after` is running that was not running (or did not exist) in `before`. */
export function timerStarted(before: cards.CardList, after: cards.CardList): boolean {
  for (const card of after.cards) {
    if (card.kind !== 'timer' || card.timer.phase !== 'running') continue
    const old = cards.findCard(before, card.id)
    if (old?.kind !== 'timer' || old.timer.phase !== 'running') return true
  }
  return false
}

/** Creates the alarm's decision logic over `store` and `platform`. Starts silent. */
export function createAlarmCore(
  store: Pick<AlarmStore, 'settle' | 'timer'>,
  platform: AlarmPlatform,
  options: AlarmOptions = {},
): AlarmCore {
  const sound = options.sound ?? DEFAULT_SOUND
  const volume = options.volume ?? DEFAULT_VOLUME
  const bump = options.bump ?? frameNow
  /** Notifications on screen (or attempted: null when the platform refused), by card id. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never read reactively
  const notified = new Map<cards.CardId, NotificationHandle | null>()
  let sounding = false
  let permissionAsked = false
  let previous: cards.CardList | null = null
  let disposed = false

  function wake(): void {
    if (!disposed) store.settle(bump())
  }

  function askPermission(): void {
    if (permissionAsked) return
    permissionAsked = true
    if (platform.notifications.permission() === 'default') void platform.notifications.request()
  }

  function notify(card: cards.Card): void {
    const id = card.id
    notified.set(
      id,
      platform.notifications.show({
        title: card.name,
        body: NOTIFICATION_BODY,
        tag: id,
        requireInteraction: true,
        onClick: () => {
          store.timer(id, timer.dismiss)
        },
      }),
    )
  }

  return {
    sync(list) {
      if (disposed) return
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
      const ringing = new Set<cards.CardId>()
      let audible = false
      for (const card of list.cards) {
        if (card.kind !== 'timer' || card.timer.phase !== 'ringing') continue
        ringing.add(card.id)
        if (!card.muted) audible = true
      }

      if (audible && !sounding) {
        platform.audio.play(sound, { loop: true, volume })
        sounding = true
      } else if (!audible && sounding) {
        platform.audio.stop()
        sounding = false
      }

      for (const [id, handle] of notified) {
        if (ringing.has(id)) continue
        handle?.close()
        notified.delete(id)
      }
      for (const card of list.cards) {
        if (ringing.has(card.id) && !notified.has(card.id)) notify(card)
      }

      // Keyboard and palette starts reach here a moment after their gesture, still inside the
      // browser's activation window; buttons call prime() synchronously instead.
      if (previous !== null && timerStarted(previous, list)) askPermission()
      previous = list

      platform.wake.schedule(cards.nextDeadline(list), wake)
    },

    prime() {
      if (disposed) return
      platform.audio.unlock()
      askPermission()
    },

    dispose() {
      if (disposed) return
      disposed = true
      if (sounding) platform.audio.stop()
      sounding = false
      for (const handle of notified.values()) handle?.close()
      notified.clear()
      platform.wake.schedule(null, () => undefined)
    },
  }
}

/**
 * Starts the app's alarm: watches `store` in an effect root (so it lives outside any component)
 * and unlocks audio on every gesture. Call {@link Alarm.destroy} to stop it.
 */
export function createAlarm(
  store: AlarmStore,
  platform: AlarmPlatform,
  options: AlarmOptions = {},
): Alarm {
  const core = createAlarmCore(store, platform, options)
  const removeGestures = unlockAudioOnGestures(platform.audio, options.gestureTarget)
  const stop = $effect.root(() => {
    $effect(() => {
      core.sync(store.list)
    })
  })
  return {
    prime() {
      core.prime()
    },
    destroy() {
      stop()
      removeGestures()
      core.dispose()
    },
  }
}
