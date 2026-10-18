/**
 * How the sync status reads (the Account section's status line and the action bar's cloud
 * button): a message per status, "Synced 5 minutes ago" from the time of the last exchange, and
 * the Material Symbol for each status. Pure; texts come from the messages and `Intl` in the
 * given locale.
 */
import { m } from '../../i18n'
import type { IconName } from '../primitives/icons'
import type { SyncStatus } from './types'

/** The cloud icon for each sync status (in the app's icon set, `ui/primitives/icons.ts`). */
export type SyncIconName = Extract<IconName, 'cloud_done' | 'cloud_sync' | 'cloud_off'>

/** The icon the action bar and the status line show for `status`. */
export function syncIcon(status: SyncStatus): SyncIconName {
  switch (status) {
    case 'online':
      return 'cloud_done'
    case 'connecting':
      return 'cloud_sync'
    case 'offline':
    case 'off':
      return 'cloud_off'
  }
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago `then` was, at `now`, in `locale`: "5 minutes ago", "2 hours ago", "3 days ago"
 * (`Intl.RelativeTimeFormat`, whole units rounded down). `null` under a minute (or for a time in
 * the future, a clock that moved back), which reads as "just now".
 */
export function timeAgo(then: number, now: number, locale: string): string | null {
  const elapsed = now - then
  if (!Number.isFinite(elapsed) || elapsed < MINUTE) return null
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
  if (elapsed < HOUR) return format.format(-Math.floor(elapsed / MINUTE), 'minute')
  if (elapsed < DAY) return format.format(-Math.floor(elapsed / HOUR), 'hour')
  return format.format(-Math.floor(elapsed / DAY), 'day')
}

/** When the last exchange was, as "Synced just now" or "Synced 5 minutes ago". */
function syncedText(lastSyncAt: number | null, now: number, locale: string): string {
  const ago = lastSyncAt === null ? null : timeAgo(lastSyncAt, now, locale)
  return ago === null ? m.account_sync_just_now() : m.account_sync_ago({ time: ago })
}

/**
 * The status line: "Synced just now" / "Synced 5 minutes ago" while online, "Connecting…",
 * "Offline. Changes sync when you're back." or "Not syncing" (signed in, sync stopped).
 */
export function syncStatusText(
  status: SyncStatus,
  lastSyncAt: number | null,
  now: number,
  locale: string,
): string {
  switch (status) {
    case 'online':
      return syncedText(lastSyncAt, now, locale)
    case 'connecting':
      return m.account_sync_connecting()
    case 'offline':
      return m.account_sync_offline()
    case 'off':
      return m.account_sync_off()
  }
}

/** The status in a word or two, for the action bar's button: "Synced", "Offline", … */
export function syncStatusShortText(status: SyncStatus): string {
  switch (status) {
    case 'online':
      return m.account_sync_short_online()
    case 'connecting':
      return m.account_sync_connecting()
    case 'offline':
      return m.account_sync_short_offline()
    case 'off':
      return m.account_sync_off()
  }
}

/**
 * The line under the status while not online: "Last synced 5 minutes ago", or `null` when there
 * was no exchange yet or it was under a minute ago.
 */
export function lastSyncedText(
  status: SyncStatus,
  lastSyncAt: number | null,
  now: number,
  locale: string,
): string | null {
  if (status === 'online' || lastSyncAt === null) return null
  const ago = timeAgo(lastSyncAt, now, locale)
  return ago === null ? null : m.account_sync_last({ time: ago })
}
