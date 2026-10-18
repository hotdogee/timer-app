import { afterEach, describe, expect, it } from 'vitest'

import { setAppLocale } from '../../i18n'
import { lastSyncedText, syncIcon, syncStatusShortText, syncStatusText, timeAgo } from './status'
import { iconPath } from '../primitives/icons'

afterEach(() => {
  setAppLocale('en')
})

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const MINUTE = 60_000

describe('timeAgo', () => {
  it('is null under a minute and for a time ahead', () => {
    expect(timeAgo(NOW, NOW, 'en')).toBeNull()
    expect(timeAgo(NOW - 59_999, NOW, 'en')).toBeNull()
    expect(timeAgo(NOW + 5 * MINUTE, NOW, 'en')).toBeNull()
    expect(timeAgo(Number.NaN, NOW, 'en')).toBeNull()
  })

  it('counts whole minutes, hours and days, rounded down', () => {
    expect(timeAgo(NOW - MINUTE, NOW, 'en')).toBe('1 minute ago')
    expect(timeAgo(NOW - 59 * MINUTE - 59_000, NOW, 'en')).toBe('59 minutes ago')
    expect(timeAgo(NOW - 61 * MINUTE, NOW, 'en')).toBe('1 hour ago')
    expect(timeAgo(NOW - 25 * 60 * MINUTE, NOW, 'en')).toBe('1 day ago')
  })

  it('speaks the given locale', () => {
    expect(timeAgo(NOW - 5 * MINUTE, NOW, 'zh-TW')).toBe('5 分鐘前')
    expect(timeAgo(NOW - 5 * MINUTE, NOW, 'ja')).toBe('5 分前')
  })
})

describe('syncStatusText', () => {
  it('says how long ago the last exchange was while online', () => {
    expect(syncStatusText('online', null, NOW, 'en')).toBe('Synced just now')
    expect(syncStatusText('online', NOW - 30_000, NOW, 'en')).toBe('Synced just now')
    expect(syncStatusText('online', NOW - 5 * MINUTE, NOW, 'en')).toBe('Synced 5 minutes ago')
  })

  it('names the other states', () => {
    expect(syncStatusText('connecting', NOW, NOW, 'en')).toBe('Connecting…')
    expect(syncStatusText('offline', NOW, NOW, 'en')).toBe(
      "Offline. Changes sync when you're back.",
    )
    expect(syncStatusText('off', null, NOW, 'en')).toBe('Not syncing')
  })

  it('reads well in Chinese and Japanese', () => {
    setAppLocale('zh-TW')
    expect(syncStatusText('online', NOW - 5 * MINUTE, NOW, 'zh-TW')).toBe('已於 5 分鐘前同步')
    setAppLocale('ja')
    expect(syncStatusText('online', NOW - 5 * MINUTE, NOW, 'ja')).toBe('5 分前に同期しました')
  })
})

describe('lastSyncedText', () => {
  it('adds when the last exchange was while not online', () => {
    expect(lastSyncedText('offline', NOW - 3 * MINUTE, NOW, 'en')).toBe('Last synced 3 minutes ago')
    expect(lastSyncedText('connecting', NOW - 2 * 60 * MINUTE, NOW, 'en')).toBe(
      'Last synced 2 hours ago',
    )
  })

  it('says nothing online, before any exchange, or within the minute', () => {
    expect(lastSyncedText('online', NOW - 3 * MINUTE, NOW, 'en')).toBeNull()
    expect(lastSyncedText('offline', null, NOW, 'en')).toBeNull()
    expect(lastSyncedText('offline', NOW - 1000, NOW, 'en')).toBeNull()
  })
})

describe('the action bar’s words and icons', () => {
  it('has a short status and an icon per state', () => {
    expect(syncStatusShortText('online')).toBe('Synced')
    expect(syncStatusShortText('connecting')).toBe('Connecting…')
    expect(syncStatusShortText('offline')).toBe('Offline')
    expect(syncStatusShortText('off')).toBe('Not syncing')
    expect(syncIcon('online')).toBe('cloud_done')
    expect(syncIcon('connecting')).toBe('cloud_sync')
    expect(syncIcon('offline')).toBe('cloud_off')
    expect(syncIcon('off')).toBe('cloud_off')
  })

  it('draws each status with an icon of the app’s set', () => {
    const icons = (['online', 'connecting', 'offline'] as const).map(syncIcon)
    for (const name of icons) expect(iconPath(name)).toMatch(/^[Mm]/)
    expect(new Set(icons.map(iconPath)).size).toBe(3)
  })
})
