import 'fake-indexeddb/auto'

import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cards, exportFormat, settings, timer, type EpochMs } from '../core'
import { FIRST_CARD_ID } from '../sync/bootstrap'
import { createAppStores } from '../sync/stores'
import {
  startAppData,
  type AppData,
  type AppDataOptions,
  type AppDataTarget,
} from './app-data.svelte'
import { createCardStore } from './cards.svelte'
import { BUILTIN_PRESETS } from './presets'
import { createPresetStore } from './presets.svelte'
import { createSettingsStore } from './settings.svelte'

// The app's singletons read ids from the platform layer; these tests use their own state.
vi.mock('../platform', () => ({ platform: { ids: { newId: () => 'unused' } } }))

const MINUTE = 60_000
/** 14:47 UTC on 2026-10-17. */
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

const running: AppData[] = []
const cleanups: (() => void)[] = []
afterEach(async () => {
  for (const data of running.splice(0)) await data.stop()
  for (const cleanup of cleanups.splice(0)) cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

let n = 0
/** Storage names of one test's "browser profile". */
function profile(): NonNullable<AppDataOptions['storage']> {
  n++
  const id = `${String(n)}-${String(Math.random())}`
  return { dbName: `db-${id}`, deviceKey: `device-${id}`, channel: `channel-${id}` }
}

/** Fresh stores and state, as one tab of the app has them. */
function freshTarget(prefix = 'card'): AppDataTarget {
  const stores = createAppStores()
  let ids = 0
  const settingsStore = createSettingsStore(stores)
  const presetStore = createPresetStore(stores.synced, { newId: () => `preset-${String(++ids)}` })
  cleanups.push(() => {
    settingsStore.destroy()
    presetStore.destroy()
  })
  return {
    stores,
    settingsStore,
    presetStore,
    cardStore: createCardStore({
      newId: () => `${prefix}-${String(++ids)}`,
      clock: () => NOW,
      bump: () => NOW,
    }),
  }
}

/** Starts one tab of the app on `storage` at time `at`. */
async function open(
  storage: NonNullable<AppDataOptions['storage']>,
  at: EpochMs = NOW,
  extra: Partial<AppDataOptions> = {},
): Promise<AppData> {
  const data = await startAppData({ now: () => at, storage, target: freshTarget(), ...extra })
  running.push(data)
  return data
}

/** An IndexedDB factory whose every `open` fails, as a transient read failure does. */
function failingOpen(real: IDBFactory): IDBFactory {
  return {
    ...real,
    open() {
      const request = {} as IDBOpenDBRequest
      setTimeout(() => {
        request.onerror?.call(request, new Event('error'))
      })
      return request
    },
  }
}

/** Closes a tab: stops saving after a last save. */
async function close(data: AppData): Promise<void> {
  running.splice(running.indexOf(data), 1)
  await data.stop()
}

describe('startAppData on a fresh install', () => {
  it('seeds one selected 5:00 timer and the built-in presets, saving both', async () => {
    const data = await open(profile())
    expect(data.saving).toEqual({ synced: true, device: true })
    expect(data.cardStore.cards).toEqual([cards.createTimerCard(FIRST_CARD_ID, 'Timer', NOW)])
    expect(data.cardStore.selected?.id).toBe(FIRST_CARD_ID)
    expect(data.presetStore.presets).toEqual(BUILTIN_PRESETS)
    expect(data.settingsStore.synced).toEqual(settings.SYNCED_DEFAULTS)
    expect(data.settingsStore.device).toEqual(settings.DEVICE_DEFAULTS)
  })

  it('seeds the presets it is given', async () => {
    const seedPresets = [{ id: 'tea', name: 'お茶', duration: 3 * MINUTE }]
    const data = await open(profile(), NOW, { seedPresets })
    expect(data.presetStore.presets).toEqual(seedPresets)
  })

  it('still starts, in memory and seeded, when IndexedDB is missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('indexedDB', undefined)
    try {
      const data = await open(profile())
      expect(data.saving.synced).toBe(false)
      expect(data.cardStore.cards).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('startAppData after a reload', () => {
  it('loads the saved cards, presets and settings, and does not seed again', async () => {
    const storage = profile()
    const first = await open(storage)
    first.cardStore.rename(FIRST_CARD_ID, 'Tea')
    first.cardStore.addStopwatch()
    first.cardStore.setMuted(FIRST_CARD_ID, true)
    first.cardStore.move(FIRST_CARD_ID, 1)
    first.presetStore.remove('eggs')
    first.settingsStore.updateSynced({ loop: false, keymap: { newTimer: ['Shift+T'] } })
    first.settingsStore.updateDevice({ themeMode: 'dark', locale: 'ja' })
    flushSync()
    const saved = first.cardStore.cards
    await close(first)

    const second = await open(storage, NOW + MINUTE)
    expect(second.cardStore.cards).toEqual(saved)
    expect(second.cardStore.cards.map((card) => card.name)).toEqual(['Stopwatch', 'Tea'])
    expect(second.cardStore.selected?.id).toBe(saved[0]?.id)
    expect(second.presetStore.presets.map((p) => p.id)).toEqual(['tea', 'pomodoro', 'break'])
    expect(second.settingsStore.synced).toMatchObject({ loop: false })
    expect(second.settingsStore.bindings.newTimer).toEqual(['Shift+T'])
    expect(second.settingsStore.device).toMatchObject({ themeMode: 'dark', locale: 'ja' })
  })

  it('does not bring the first-run card back after every card was deleted', async () => {
    const storage = profile()
    const first = await open(storage)
    first.cardStore.remove(FIRST_CARD_ID)
    flushSync()
    await close(first)
    const second = await open(storage)
    expect(second.cardStore.cards).toEqual([])
    expect(second.presetStore.presets).toHaveLength(4)
  })

  it('keeps a running timer running, and rings one that ended while the app was closed', async () => {
    const storage = profile()
    const first = await open(storage)
    first.cardStore.addTimer(10 * MINUTE)
    first.cardStore.timer(FIRST_CARD_ID, timer.start)
    first.cardStore.timer('card-1', timer.start)
    flushSync()
    await close(first)

    const later = NOW + 6 * MINUTE
    const second = await open(storage, later)
    const [short, long] = second.cardStore.cards
    expect(short?.kind === 'timer' && short.timer).toEqual({
      phase: 'ringing',
      duration: 5 * MINUTE,
      endedAt: NOW + 5 * MINUTE,
    })
    expect(long?.kind === 'timer' && long.timer).toEqual({
      phase: 'running',
      duration: 10 * MINUTE,
      endsAt: NOW + 10 * MINUTE,
    })
    // The settled state is saved too.
    await close(second)
    const third = await open(storage, later)
    expect(third.cardStore.cards[0]).toEqual(short)
  })

  it('hands over the device settings before loading the synced store', async () => {
    const storage = profile()
    const first = await open(storage)
    first.settingsStore.updateDevice({ themeMode: 'dark' })
    await close(first)
    let seen: { device: settings.DeviceSettings; cardsLoaded: number } | null = null
    const target = freshTarget()
    const data = await startAppData({
      now: () => NOW,
      storage,
      target,
      onDeviceReady: (device) => {
        seen = { device, cardsLoaded: target.cardStore.cards.length }
      },
    })
    running.push(data)
    expect(seen).toEqual({
      device: { ...settings.DEVICE_DEFAULTS, themeMode: 'dark' },
      cardsLoaded: 0,
    })
    expect(data.cardStore.cards).toHaveLength(1)
  })
})

describe('replaceAll', () => {
  /** An export file's data, read back the way Import reads it. */
  function importFile(content: Partial<exportFormat.ExportContent>): exportFormat.ExportData {
    const text = exportFormat.stringifyExport(
      exportFormat.createExport({
        exportedAt: NOW,
        cards: [],
        presets: [],
        settings: { synced: settings.SYNCED_DEFAULTS, device: settings.DEVICE_DEFAULTS },
        ...content,
      }),
    )
    const parsed = exportFormat.parseExport(text)
    if (!parsed.ok) throw new Error(parsed.reason)
    return parsed.data
  }

  it('replaces cards, presets and both settings groups, and saves them', async () => {
    const storage = profile()
    const data = await open(storage, NOW + 2 * MINUTE)
    const tea = cards.createTimerCard('tea', 'Tea', NOW, 3 * MINUTE)
    const ended = {
      ...cards.createTimerCard('egg', 'Egg', NOW, MINUTE),
      timer: { phase: 'running', duration: MINUTE, endsAt: NOW + MINUTE } as const,
    }
    const laps = {
      ...cards.createStopwatchCard('laps', 'Laps', NOW),
      stopwatch: { phase: 'paused', accumulated: 5000, laps: [1000, 3000] } as const,
    }
    data.replaceAll(
      importFile({
        cards: [tea, ended, laps],
        presets: [{ id: 'coffee', name: 'Coffee', duration: 4 * MINUTE }],
        settings: {
          synced: { ...settings.SYNCED_DEFAULTS, sound: 'bell', confirmDelete: true },
          device: { ...settings.DEVICE_DEFAULTS, density: 'compact', locale: 'zh-TW' },
        },
      }),
    )
    // The imported cards are settled: the egg timer ended while the file sat on disk.
    const ringing = {
      ...ended,
      timer: { phase: 'ringing', duration: MINUTE, endedAt: NOW + MINUTE },
    }
    expect(data.cardStore.cards).toEqual([tea, ringing, laps])
    expect(data.cardStore.selected?.id).toBe('tea')
    expect(data.presetStore.presets).toEqual([
      { id: 'coffee', name: 'Coffee', duration: 4 * MINUTE },
    ])
    expect(data.settingsStore.synced).toMatchObject({ sound: 'bell', confirmDelete: true })
    expect(data.settingsStore.device).toMatchObject({ density: 'compact', locale: 'zh-TW' })

    flushSync()
    await close(data)
    const back = await open(storage, NOW + 2 * MINUTE)
    expect(back.cardStore.cards).toEqual([tea, ringing, laps])
    expect(back.presetStore.presets.map((p) => p.id)).toEqual(['coffee'])
    expect(back.settingsStore.synced.sound).toBe('bell')
    expect(back.settingsStore.device.locale).toBe('zh-TW')
  })

  it('keeps the selection when its card is in the file, and forgets a pending undo', async () => {
    const data = await open(profile())
    const keep = data.cardStore.addTimer(MINUTE, 'Keep')
    const gone = data.cardStore.addTimer(MINUTE, 'Gone')
    data.cardStore.select(keep)
    data.cardStore.remove(gone)
    flushSync()
    expect(data.cardStore.lastRemoved).not.toBeNull()
    const kept = data.cardStore.cards.filter((card) => card.id === keep)
    data.replaceAll(importFile({ cards: [cards.createTimerCard('new', 'New', NOW), ...kept] }))
    expect(data.cardStore.list.selectedId).toBe(keep)
    expect(data.cardStore.lastRemoved).toBeNull()
    expect(data.cardStore.undoRemove()).toBe(false)
  })

  it('can empty everything', async () => {
    const data = await open(profile())
    data.replaceAll(importFile({}))
    expect(data.cardStore.cards).toEqual([])
    expect(data.presetStore.presets).toEqual([])
  })
})

describe('two tabs of the app', () => {
  it('show each other’s changes within moments', async () => {
    const storage = profile()
    const one = await open(storage)
    const two = await open(storage)
    await Promise.all([one.ready, two.ready])
    expect(two.cardStore.cards).toEqual(one.cardStore.cards)

    const id = one.cardStore.addTimer(MINUTE, 'Tea')
    one.cardStore.timer(id, timer.start)
    flushSync()
    await vi.waitFor(() => {
      expect(two.cardStore.cards.find((card) => card.id === id)).toEqual(
        one.cardStore.cards.find((card) => card.id === id),
      )
    })

    two.settingsStore.updateSynced({ volume: 0.3 })
    two.presetStore.rename('tea', 'Green tea')
    await vi.waitFor(() => {
      expect(one.settingsStore.synced.volume).toBe(0.3)
      expect(one.presetStore.presets[0]?.name).toBe('Green tea')
    })
    // Selection stays per tab.
    two.cardStore.select(FIRST_CARD_ID)
    expect(one.cardStore.list.selectedId).toBe(id)
  })

  it('end with one first-run card when a fresh install opens in two at once', async () => {
    const storage = profile()
    const [one, two] = await Promise.all([
      open(storage, NOW, { target: freshTarget('a') }),
      open(storage, NOW, { target: freshTarget('b') }),
    ])
    await Promise.all([one.ready, two.ready])
    await vi.waitFor(() => {
      expect(one.cardStore.cards.map((card) => card.id)).toEqual([FIRST_CARD_ID])
      expect(two.cardStore.cards).toEqual(one.cardStore.cards)
    })
    expect(one.presetStore.presets).toEqual(BUILTIN_PRESETS)
  })

  it('do not take a seed from a tab that could not read storage', async () => {
    const storage = profile()
    const one = await open(storage)
    one.cardStore.rename(FIRST_CARD_ID, 'Laundry')
    one.presetStore.rename('tea', 'Green tea')
    one.presetStore.remove('eggs')
    flushSync()
    const cardsBefore = one.cardStore.cards
    const presetsBefore = one.presetStore.presets

    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const real = globalThis.indexedDB
    globalThis.indexedDB = failingOpen(real)
    let two: AppData
    try {
      two = await open(storage, NOW + MINUTE, { target: freshTarget('b') })
    } finally {
      globalThis.indexedDB = real
    }
    expect(two.saving.synced).toBe(false)
    // The failed tab shows the healthy tab's data instead of seeding its own.
    expect(two.cardStore.cards).toEqual(cardsBefore)
    expect(two.presetStore.presets).toEqual(presetsBefore)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(one.cardStore.cards).toEqual(cardsBefore)
    expect(one.presetStore.presets).toEqual(presetsBefore)
  })

  it('add no card for each new tab when storage is blocked everywhere', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.stubGlobal('indexedDB', undefined)
    try {
      const storage = profile()
      const one = await open(storage, NOW, { target: freshTarget('a') })
      expect(one.cardStore.cards).toHaveLength(1)
      const two = await open(storage, NOW, { target: freshTarget('b') })
      const three = await open(storage, NOW, { target: freshTarget('c') })
      await new Promise((resolve) => setTimeout(resolve, 50))
      for (const tab of [one, two, three]) {
        expect(tab.cardStore.cards.map((card) => card.id)).toEqual([FIRST_CARD_ID])
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
