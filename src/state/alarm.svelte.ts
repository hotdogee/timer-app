/**
 * Alarm orchestration (spec › Time's up): turns the card list and the alarm settings into side
 * effects.
 *
 * - Sound: one alarm sound at a time, while any unmuted timer is ringing; it stops when none is.
 *   It loops by default; with `loop` off it plays once for each card that starts ringing.
 * - Auto-stop: with `autoStopMinutes` above 0, a card's sound and notification end that long after
 *   it started ringing; the card itself stays on time's up until dismissed.
 * - Notifications (unless turned off): one system notification per ringing card, shown when it
 *   starts ringing and closed when it stops; clicking it focuses the app and dismisses that card.
 * - Background wake: the next deadline (the earliest running timer's end, or an auto-stop) is
 *   handed to the platform wake scheduler, which settles the cards on time even in a hidden tab,
 *   where animation frames stop.
 * - Gestures: audio is unlocked on every pointer or key gesture, and notification permission is
 *   asked for the first time a timer starts (while notifications are on).
 *
 * The decisions live in {@link createAlarmCore}, a plain object driven by `sync(list)` so it can be
 * tested without a DOM; {@link createAlarm} runs it from an effect on the card store and the
 * settings.
 */
import { untrack } from 'svelte'

import { cards, timer, type Clock, type EpochMs, type Ms } from '../core'
import { m } from '../i18n'
import {
  DEFAULT_SOUND,
  DEFAULT_VOLUME,
  unlockAudioOnGestures,
  type NotificationHandle,
  type Platform,
  type SoundId,
} from '../platform'
import { frameClock } from '../ui/frame-clock.svelte'
import { appClock } from './app-clock'
import type { CardStore } from './cards.svelte'

/** The card store actions the alarm uses. */
export type AlarmStore = Pick<CardStore, 'list' | 'settle' | 'timer'>

/** The platform services the alarm uses. */
export type AlarmPlatform = Pick<Platform, 'audio' | 'notifications' | 'wake'>

/** The alarm settings (spec › Settings › Behavior); `settings.SyncedSettings` fits. */
export interface AlarmSettings {
  readonly sound: SoundId
  /** 0 to 1. */
  readonly volume: number
  /** Loop the sound until dismissed; otherwise play it once per ringing card. */
  readonly loop: boolean
  /** Minutes after which a ringing card's sound and notification end; 0 = never. */
  readonly autoStopMinutes: number
  /** Whether ringing cards show system notifications. */
  readonly notifications: boolean
}

/** The alarm settings of a new install: the platform's default sound, looping, never quiet. */
export const DEFAULT_ALARM_SETTINGS: AlarmSettings = Object.freeze({
  sound: DEFAULT_SOUND,
  volume: DEFAULT_VOLUME,
  loop: true,
  autoStopMinutes: 0,
  notifications: true,
})

/** Everything the alarm reads besides the card list; every field has a default. */
export interface AlarmOptions {
  /**
   * The alarm settings, read on every sync. Pass a getter over reactive state
   * (`() => settingsStore.synced`): `createAlarm` then syncs again whenever they change.
   * Defaults to {@link DEFAULT_ALARM_SETTINGS}.
   */
  readonly settings?: (() => AlarmSettings) | undefined
  /** The time, for auto-stop. Defaults to the app clock (the frame clock's source). */
  readonly clock?: Clock | undefined
  /** Reads the clock for a wake-up and returns that `now`. Defaults to bumping the frame clock. */
  readonly bump?: (() => EpochMs) | undefined
  /**
   * Where pointer and key gestures unlock audio: the window by default, `null` for nowhere (tests).
   */
  readonly gestureTarget?: EventTarget | null | undefined
}

/** The alarm's decisions, driven by the card list. */
export interface AlarmCore {
  /**
   * Brings sound, notifications and the wake-up in line with `list`, the settings and the time.
   * Call it on every change of the list or the settings.
   */
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

const MINUTE: Ms = 60_000

/**
 * When a card that started ringing at `endedAt` goes quiet: `autoStopMinutes` later, or never
 * (`Infinity`) when auto-stop is off.
 */
export function autoStopAt(endedAt: EpochMs, autoStopMinutes: number): EpochMs {
  return Number.isFinite(autoStopMinutes) && autoStopMinutes > 0
    ? endedAt + autoStopMinutes * MINUTE
    : Number.POSITIVE_INFINITY
}

/** The sound the alarm asked the player for, to notice a change of settings. */
interface Playing {
  readonly sound: SoundId
  readonly volume: number
  readonly loop: boolean
}

/** Creates the alarm's decision logic over `store` and `platform`. Starts silent. */
export function createAlarmCore(
  store: Pick<AlarmStore, 'settle' | 'timer'>,
  platform: AlarmPlatform,
  options: AlarmOptions = {},
): AlarmCore {
  const readSettings = options.settings ?? (() => DEFAULT_ALARM_SETTINGS)
  const clock = options.clock ?? appClock
  const bump = options.bump ?? frameNow
  /**
   * Notifications by card id while the card rings: on screen, or null when the platform refused
   * or auto-stop closed it (so it is not shown again while the card keeps ringing).
   */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never read reactively
  const notified = new Map<cards.CardId, NotificationHandle | null>()
  /** Ringing cards that have been heard (the loop, or their one play), so none plays twice. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping, never read reactively
  const heard = new Set<cards.CardId>()
  let playing: Playing | null = null
  let permissionAsked = false
  let previous: cards.CardList | null = null
  let disposed = false

  function wake(): void {
    if (disposed) return
    store.settle(bump())
    // An auto-stop changes no card, so nothing else would sync now: do it here. (When the settle
    // did change the list, the store's watcher syncs again with it, which is harmless.)
    if (previous !== null) sync(previous)
  }

  function askPermission(): void {
    if (permissionAsked || !readSettings().notifications) return
    permissionAsked = true
    if (platform.notifications.permission() === 'default') void platform.notifications.request()
  }

  function notify(card: cards.Card): void {
    const id = card.id
    notified.set(
      id,
      platform.notifications.show({
        title: card.name,
        // In the locale active when the card starts ringing.
        body: m.notification_times_up(),
        tag: id,
        requireInteraction: true,
        onClick: () => {
          store.timer(id, timer.dismiss)
        },
      }),
    )
  }

  function play(next: Playing): void {
    platform.audio.play(next.sound, { loop: next.loop, volume: next.volume })
    playing = next
  }

  function stop(): void {
    if (playing === null) return
    platform.audio.stop()
    playing = null
  }

  /** Plays, keeps or stops the sound for what is audible now. */
  function updateSound(settings: AlarmSettings, audible: boolean, firstHeard: boolean): void {
    const wanted: Playing = { sound: settings.sound, volume: settings.volume, loop: settings.loop }
    if (!audible) {
      stop()
    } else if (wanted.loop) {
      // Re-asserting the same loop would restart nothing, but a new sound or volume must apply.
      const same =
        playing?.loop === true && playing.sound === wanted.sound && playing.volume === wanted.volume
      if (!same) play(wanted)
    } else if (firstHeard) {
      play(wanted)
    } else if (playing?.loop === true) {
      // Loop turned off while ringing: every ringing card has been heard already.
      stop()
    }
  }

  /** Shows a notification for each live ringing card; closes the rest. */
  function updateNotifications(
    list: cards.CardList,
    settings: AlarmSettings,
    ringing: ReadonlySet<cards.CardId>,
    live: ReadonlySet<cards.CardId>,
  ): void {
    for (const [id, handle] of notified) {
      if (settings.notifications && live.has(id)) continue
      handle?.close()
      // Past its auto-stop the card keeps ringing: remember it, so it is not shown again.
      if (settings.notifications && ringing.has(id)) notified.set(id, null)
      else notified.delete(id)
    }
    if (!settings.notifications) return
    for (const card of list.cards) {
      if (live.has(card.id) && !notified.has(card.id)) notify(card)
    }
  }

  function sync(list: cards.CardList): void {
    if (disposed) return
    const settings = readSettings()
    const now = clock()
    /** Every ringing card, and those still before their auto-stop ("live"). */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
    const ringing = new Set<cards.CardId>()
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
    const live = new Set<cards.CardId>()
    let audible = false
    let firstHeard = false
    let nextStop = Number.POSITIVE_INFINITY
    for (const card of list.cards) {
      if (card.kind !== 'timer' || card.timer.phase !== 'ringing') continue
      ringing.add(card.id)
      const stopAt = autoStopAt(card.timer.endedAt, settings.autoStopMinutes)
      if (now >= stopAt) continue
      live.add(card.id)
      nextStop = Math.min(nextStop, stopAt)
      if (card.muted) continue
      audible = true
      if (!heard.has(card.id)) {
        firstHeard = true
        heard.add(card.id)
      }
    }
    for (const id of heard) if (!ringing.has(id)) heard.delete(id)

    updateSound(settings, audible, firstHeard)
    updateNotifications(list, settings, ringing, live)

    // Keyboard and palette starts reach here a moment after their gesture, still inside the
    // browser's activation window; buttons call prime() synchronously instead.
    if (previous !== null && timerStarted(previous, list)) askPermission()
    previous = list

    const next = Math.min(cards.nextDeadline(list) ?? Number.POSITIVE_INFINITY, nextStop)
    platform.wake.schedule(Number.isFinite(next) ? next : null, wake)
  }

  return {
    sync,

    prime() {
      if (disposed) return
      platform.audio.unlock()
      askPermission()
    },

    dispose() {
      if (disposed) return
      disposed = true
      stop()
      for (const handle of notified.values()) handle?.close()
      notified.clear()
      heard.clear()
      platform.wake.schedule(null, () => undefined)
    },
  }
}

/**
 * Starts the app's alarm: watches `store` and the settings getter in an effect root (so it lives
 * outside any component) and unlocks audio on every gesture. Call {@link Alarm.destroy} to stop it.
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
      // The core reads the settings getter here too, so a settings change syncs again.
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
