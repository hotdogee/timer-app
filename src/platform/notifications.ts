/**
 * System notifications for time's up (spec Q7). The web implementation uses the `Notification`
 * constructor; the desktop app uses the Tauri notification plugin behind the same interface
 * (`tauri/notifications.ts`).
 */

/** Permission to show notifications, or `'unsupported'` when the platform has no notifications. */
export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

/** What a notification shows and does. */
export interface NotificationRequest {
  readonly title: string
  readonly body: string
  /** Identifies the notification: a new one with the same tag replaces it (use the card id). */
  readonly tag: string
  /** Runs when the user clicks the notification, after the app window has been focused. */
  readonly onClick?: (() => void) | undefined
  /**
   * Keep the notification on screen until the user acts on it, where the platform supports it
   * (Chromium on desktop). Defaults to false. Suits an alarm that rings until dismissed.
   */
  readonly requireInteraction?: boolean | undefined
}

/** A notification on screen. */
export interface NotificationHandle {
  /** Removes the notification. Idempotent; safe after the user closed it. */
  close(): void
}

/** Shows system notifications. */
export interface Notifier {
  /** Whether this platform can show notifications at all. */
  readonly supported: boolean
  /** The current permission, read fresh on every call (the user can change it at any time). */
  permission(): NotificationPermissionState
  /**
   * Asks for permission if it has not been decided yet and resolves to whether notifications may
   * be shown. Call it from a user gesture (browsers ignore or penalize unprompted requests).
   * Never rejects.
   */
  request(): Promise<boolean>
  /** Shows a notification, or returns null when unsupported, not permitted, or it failed. */
  show(notification: NotificationRequest): NotificationHandle | null
}

/** The parts of a web `Notification` this module uses. */
export interface NotificationLike {
  onclick: ((event: Event) => unknown) | null
  close(): void
}

/** The parts of the web `Notification` constructor this module uses. */
export interface NotificationConstructorLike {
  readonly permission: NotificationPermission
  /** Older Safari only calls the callback and returns undefined; newer engines return a promise. */
  requestPermission(
    callback?: (permission: NotificationPermission) => void,
  ): Promise<NotificationPermission> | undefined
  new (title: string, options?: NotificationOptions): NotificationLike
}

/** Dependencies of {@link createWebNotifier}; every field has a browser default. */
export interface WebNotifierOptions {
  /** The `Notification` constructor, or null when the platform has none. */
  readonly Notification?: NotificationConstructorLike | null
  /** Brings the app window to the front; defaults to `window.focus()`. */
  readonly focus?: () => void
}

function defaultNotification(): NotificationConstructorLike | null {
  return (globalThis as { Notification?: NotificationConstructorLike }).Notification ?? null
}

function defaultFocus(): void {
  ;(globalThis as { focus?: () => void }).focus?.()
}

/** Creates the web notifier, backed by the `Notification` API when it exists. */
export function createWebNotifier(options: WebNotifierOptions = {}): Notifier {
  const Notify = options.Notification === undefined ? defaultNotification() : options.Notification
  const focus = options.focus ?? defaultFocus

  return {
    supported: Notify !== null,

    permission() {
      return Notify ? Notify.permission : 'unsupported'
    },

    async request() {
      if (!Notify) return false
      if (Notify.permission !== 'default') return Notify.permission === 'granted'
      try {
        const answer = await new Promise<NotificationPermission>((resolve, reject) => {
          // Called synchronously, so the request still counts as part of the caller's gesture.
          const promise = Notify.requestPermission(resolve)
          if (promise) promise.then(resolve, reject)
        })
        return answer === 'granted'
      } catch {
        return false
      }
    },

    show({ title, body, tag, onClick, requireInteraction = false }) {
      if (Notify?.permission !== 'granted') return null
      let notification: NotificationLike
      try {
        notification = new Notify(title, { body, tag, requireInteraction })
      } catch {
        // Chrome on Android only allows notifications from a service worker.
        return null
      }
      let open = true
      const close = (): void => {
        if (!open) return
        open = false
        try {
          notification.close()
        } catch {
          // Already gone.
        }
      }
      notification.onclick = () => {
        focus()
        close()
        onClick?.()
      }
      return { close }
    },
  }
}
