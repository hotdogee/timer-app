/**
 * What the webview tells the shell about the app (`src-tauri/src/activity.rs`), the tray's
 * command to the app and the tray menu's labels (`src-tauri/src/tray.rs`).
 */
import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'

import type { CloseBehavior } from '../types'
import { onWindowEvent, windowLabel } from './events'

/** Sent to the main window when the tray menu's "Start or pause the last card" is chosen. */
export const TRAY_TOGGLE_LAST = 'tray-toggle-last'

/** The label of the window that runs the app (`tauri.conf.json`). */
export const MAIN_WINDOW = 'main'

/** The tray menu's labels, in the app's language. */
export interface TrayLabels {
  readonly show: string
  readonly toggleLast: string
  readonly quit: string
}

/**
 * A setter that sends the latest value to the shell, in order, skipping repeats: a value equal
 * (by `key`) to the one last asked for sends nothing, and values asked for while a send is under
 * way collapse into the last of them. The promise settles once the shell has the latest value,
 * and rejects when a send fails.
 */
function latest<T>(
  send: (value: T) => Promise<unknown>,
  key: (value: T) => unknown = (value) => value,
): (value: T) => Promise<void> {
  let wanted: { readonly value: T; readonly key: unknown } | null = null
  let sentKey: unknown = undefined
  let sending: Promise<void> | null = null
  return (value) => {
    const next = { value, key: key(value) }
    if (wanted === null || wanted.key !== next.key) wanted = next
    if (sending !== null) return sending
    if (next.key === sentKey) return Promise.resolve()
    // Something to send, so the loop awaits before `finally`, which therefore runs after this
    // assignment; and a value asked for during a send is picked up before the loop ends.
    sending = (async () => {
      try {
        while (wanted !== null && wanted.key !== sentKey) {
          const current = wanted
          await send(current.value)
          sentKey = current.key
        }
      } finally {
        sending = null
      }
    })()
    return sending
  }
}

/** The shell's reports, one instance per service (each remembers what it sent). */
export interface ActivityReports {
  /** Command `set_running`: whether any card is running or ringing. */
  setRunning(running: boolean): Promise<void>
  /** Command `set_close_behavior`: the Settings › Desktop close behavior. */
  setCloseBehavior(behavior: CloseBehavior): Promise<void>
  /** Command `set_tray_labels`: relabels the tray menu. */
  setTrayLabels(labels: TrayLabels): Promise<void>
}

/** Reports to the shell, each value once and in order (see {@link latest}). */
export function createReports(): ActivityReports {
  return {
    setRunning: latest((running: boolean) => invoke('set_running', { running })),
    setCloseBehavior: latest((behavior: CloseBehavior) =>
      invoke('set_close_behavior', { behavior }),
    ),
    setTrayLabels: latest(
      ({ show, toggleLast, quit }: TrayLabels) =>
        invoke('set_tray_labels', { labels: { show, toggleLast, quit } }),
      ({ show, toggleLast, quit }) => JSON.stringify([show, toggleLast, quit]),
    ),
  }
}

/**
 * Calls `listener` when the tray asks to start or pause the last card. Only the main window hears
 * it (it runs the cards' actions); in another window this listens to nothing.
 */
export function onToggleLast(listener: () => void): Promise<UnlistenFn> {
  if (windowLabel() !== MAIN_WINDOW) return Promise.resolve(() => undefined)
  return onWindowEvent(TRAY_TOGGLE_LAST, () => {
    listener()
  })
}
