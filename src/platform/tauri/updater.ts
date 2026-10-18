/** Self-update through the updater and process plugins, and the shell's `updater_configured`. */
import { invoke } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

import type { UpdateCheck, UpdateInfo, UpdateProgress } from '../types'

/** The updater; one instance per service (it keeps the update its last check found). */
export interface UpdaterSession {
  /** Command `updater_configured`, asked once. Rejects when the shell fails. */
  configured(): Promise<boolean>
  /** Checks for an update; null when there is none, `'failed'` when the check failed (a warning). */
  check(): Promise<UpdateCheck>
  /** Installs the update the last check found; false when there is none or it failed. */
  install(onProgress?: (progress: UpdateProgress) => void): Promise<boolean>
  /** Restarts the app. Rejects when the shell fails. */
  restart(): Promise<void>
}

/** What the app shows of an update. */
function updateInfo(update: Update): UpdateInfo {
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? null,
    date: update.date ?? null,
  }
}

/** The updater (see {@link UpdaterSession}). */
export function createUpdater(): UpdaterSession {
  let configured: Promise<boolean> | null = null
  /** The update the last check found, until it is installed or another check replaces it. */
  let pending: Update | null = null

  const keep = (update: Update | null): void => {
    const previous = pending
    pending = update
    if (previous !== null && previous !== update) void previous.close().catch(() => undefined)
  }

  return {
    configured: () =>
      (configured ??= invoke<unknown>('updater_configured').then((value) => value === true)),
    async check() {
      try {
        const update = await check()
        keep(update)
        return update === null ? null : updateInfo(update)
      } catch (error) {
        // Offline, or the server is down: the next check tries again.
        console.warn('Timer App: could not check for updates', error)
        return 'failed'
      }
    },
    async install(onProgress) {
      const update = pending
      if (update === null) return false
      let downloaded = 0
      let total: number | null = null
      try {
        await update.downloadAndInstall((event) => {
          if (event.event === 'Started') total = event.data.contentLength ?? null
          else if (event.event === 'Progress') downloaded += event.data.chunkLength
          onProgress?.({ downloaded, total })
        })
        if (pending === update) pending = null
        return true
      } catch (error) {
        console.warn('Timer App: could not install the update', error)
        return false
      }
    },
    restart: () => relaunch(),
  }
}
