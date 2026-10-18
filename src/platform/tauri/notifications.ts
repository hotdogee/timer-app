/**
 * System notifications through the notification plugin. On desktop the plugin always has
 * permission; it can remove a shown notification only on Linux; and it reports a click on the
 * notification itself (`tap`) only for notifications shown while a listener exists (on Windows,
 * only while the toast is on screen, not from the Action Center).
 */
import {
  isPermissionGranted,
  onAction,
  removeActive,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification'

import type { NotificationPermissionState, NotificationRequest } from '../notifications'
import { showWindow } from './main-window'

/**
 * The plugin's id for a notification tag: the same tag always gives the same id, a positive
 * 31-bit integer (the plugin's ids are 32-bit signed), so a click can be traced back to its
 * notification. FNV-1a.
 */
export function notificationId(tag: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < tag.length; i += 1) {
    hash = Math.imul(hash ^ tag.charCodeAt(i), 0x01000193)
  }
  return hash >>> 1 || 1
}

/** Shows notifications; one instance per service (it routes clicks to their notification). */
export interface NotificationSender {
  /** Asks for permission (desktop grants it at once) and resolves to the answer. */
  request(): Promise<NotificationPermissionState>
  /**
   * Shows the notification unless `wanted()` turned false meanwhile, and resolves to the function
   * that removes it (where the OS lets the app: Linux) and forgets its click.
   */
  show(request: NotificationRequest, wanted: () => boolean): Promise<() => Promise<void>>
}

/** The notifications (see {@link NotificationSender}). */
export function createNotificationSender(): NotificationSender {
  /** What clicking each shown notification does, by id. */
  const clicks = new Map<number, () => void>()
  let listening: Promise<unknown> | null = null

  const listenForClicks = (): Promise<unknown> =>
    (listening ??= onAction((action) => {
      const id = action.notification?.id
      const click = action.actionId === 'tap' && id !== undefined ? clicks.get(id) : undefined
      if (id === undefined || click === undefined) return
      clicks.delete(id)
      // The window comes first, so whatever the click does happens in view.
      void showWindow()
        .catch(() => undefined)
        .then(click)
    }))

  return {
    async request() {
      if (await isPermissionGranted()) return 'granted'
      const answer = await requestPermission()
      return answer === 'granted' || answer === 'denied' ? answer : 'default'
    },
    async show({ title, body, tag, onClick }, wanted) {
      const id = notificationId(tag)
      if (onClick) {
        clicks.set(id, onClick)
        // Clicks are reported only for notifications shown while the listener exists.
        await listenForClicks()
      } else {
        clicks.delete(id)
      }
      if (wanted()) sendNotification({ id, title, body })
      return () => {
        if (onClick !== undefined && clicks.get(id) === onClick) clicks.delete(id)
        return removeActive([{ id }])
      }
    },
  }
}
