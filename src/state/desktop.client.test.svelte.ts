import { flushSync } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cards, keymap, settings, stopwatch, timer, type EpochMs } from '../core'
import type { HotkeyId, HotkeyResult, TrayLabels } from '../platform'
import { createCardStore } from './cards.svelte'
import { isActive, newlyRinging, startDesktop, type DesktopPlatform } from './desktop.svelte'
import { hotkeyStatus } from './hotkey-status.svelte'
import { createKeyboardController } from './keyboard.svelte'

const MINUTE = 60_000
const NOW = Date.UTC(2026, 9, 18, 9, 0, 0)

/** A fake shell: every report recorded, the tray and hotkey presses under the test's control. */
function fakePlatform(supported = true) {
  let pressed: ((id: HotkeyId) => void) | null = null
  let tray: (() => void) | null = null
  const results = new Map<string, HotkeyResult>()
  const platform = {
    activity: {
      supported,
      setRunning: vi.fn<(running: boolean) => void>(),
      setCloseBehavior: vi.fn<(behavior: settings.CloseBehavior) => void>(),
      onToggleLast: vi.fn((listener: () => void) => {
        tray = listener
        return () => {
          tray = null
        }
      }),
    },
    hotkeys: {
      supported,
      set: vi.fn((_id: HotkeyId, combo: string | null) =>
        Promise.resolve(results.get(combo ?? '') ?? 'ok'),
      ),
      onPressed: vi.fn((listener: (id: HotkeyId) => void) => {
        pressed = listener
        return () => {
          pressed = null
        }
      }),
    },
    shell: {
      supported,
      setTrayLabels: vi.fn<(labels: TrayLabels) => void>(),
      onMiniCard: () => () => undefined,
      smokeMark: vi.fn<(message: string) => void>(),
    },
  } satisfies DesktopPlatform
  return {
    platform,
    results,
    press: (id: HotkeyId) => {
      pressed?.(id)
    },
    tray: () => {
      tray?.()
    },
    listening: () => ({ pressed: pressed !== null, tray: tray !== null }),
  }
}

interface SetupOptions {
  readonly supported?: boolean
  readonly smoke?: boolean
  readonly hotkeys?: settings.DesktopHotkeys
  /** Combos another app holds. */
  readonly taken?: readonly string[]
}

function setup(options: SetupOptions = {}) {
  let now: EpochMs = NOW
  let n = 0
  const store = createCardStore({
    newId: () => `id${String(++n)}`,
    clock: () => NOW,
    bump: () => now,
  })
  let desktop = $state.raw<settings.DesktopSettings>(
    settings.updateDesktopSettings(settings.DESKTOP_DEFAULTS, { hotkeys: options.hotkeys ?? {} }),
  )
  let language = $state('en')
  const fake = fakePlatform(options.supported ?? true)
  for (const combo of options.taken ?? []) fake.results.set(combo, 'taken')
  const keyboard = createKeyboardController({
    cardStore: store,
    platform: 'other',
    bindings: keymap.DEFAULT_BINDINGS,
    getColumns: () => 1,
    getTyped: () => '',
    setTyped: () => undefined,
    actions: {
      openPalette: () => undefined,
      openHelp: () => undefined,
      openSettings: () => undefined,
      toggleEditMode: () => undefined,
      startRename: () => undefined,
      toggleFullscreen: () => undefined,
      miniWindow: () => undefined,
      openPresets: () => undefined,
      deleteCard: () => undefined,
      undoRemove: () => undefined,
      cancel: () => undefined,
    },
  })
  const stop = startDesktop({
    platform: fake.platform,
    list: () => store.list,
    desktop: () => desktop,
    trayLabels: () => ({
      show: `show ${language}`,
      toggleLast: `toggle ${language}`,
      quit: 'quit',
    }),
    toggleLast: () => {
      keyboard.toggleLast()
    },
    smoke: options.smoke ?? false,
    clock: () => now,
  })
  flushSync()
  return {
    store,
    fake,
    stop: () => {
      stop()
      keyboard.destroy()
    },
    setNow: (at: EpochMs) => {
      now = at
    },
    setDesktop: (update: settings.DesktopSettingsUpdate) => {
      desktop = settings.updateDesktopSettings(desktop, update)
    },
    setLanguage: (next: string) => {
      language = next
    },
  }
}

let running: (() => void)[] = []
afterEach(() => {
  for (const stop of running) stop()
  running = []
  vi.restoreAllMocks()
  hotkeyStatus.toggleLast = null
  hotkeyStatus.showApp = null
})

function started(options?: SetupOptions) {
  const s = setup(options)
  running.push(s.stop)
  return s
}

describe('isActive and newlyRinging', () => {
  it('counts running cards and ringing timers, not idle or paused ones', () => {
    const s = started()
    s.store.addTimer()
    s.store.addStopwatch()
    expect(isActive(s.store.list)).toBe(false)
    s.store.stopwatch('id2', stopwatch.start)
    expect(isActive(s.store.list)).toBe(true)
    s.store.stopwatch('id2', stopwatch.pause)
    s.store.timer('id1', timer.start)
    expect(isActive(s.store.list)).toBe(true)
    const before = s.store.list
    s.store.settle(NOW + 6 * MINUTE)
    expect(isActive(s.store.list)).toBe(true)
    expect(newlyRinging(before, s.store.list).map((card) => card.id)).toEqual(['id1'])
    expect(newlyRinging(s.store.list, s.store.list)).toEqual([])
    s.store.timer('id1', timer.dismiss)
    expect(isActive(s.store.list)).toBe(false)
    expect(isActive(cards.EMPTY_LIST)).toBe(false)
  })
})

describe('startDesktop', () => {
  it('reports whether anything runs on every change, and the close behavior', () => {
    const s = started()
    const { activity } = s.fake.platform
    expect(activity.setRunning).toHaveBeenLastCalledWith(false)
    expect(activity.setCloseBehavior).toHaveBeenLastCalledWith('tray-while-running')
    s.store.addTimer()
    s.store.timer('id1', timer.start)
    flushSync()
    expect(activity.setRunning).toHaveBeenLastCalledWith(true)
    s.store.timer('id1', timer.pause)
    flushSync()
    expect(activity.setRunning).toHaveBeenLastCalledWith(false)
    s.setDesktop({ closeBehavior: 'quit' })
    flushSync()
    expect(activity.setCloseBehavior).toHaveBeenLastCalledWith('quit')
  })

  it('labels the tray in the current language, again when it changes', () => {
    const s = started()
    const { shell } = s.fake.platform
    expect(shell.setTrayLabels).toHaveBeenLastCalledWith({
      show: 'show en',
      toggleLast: 'toggle en',
      quit: 'quit',
    })
    s.setLanguage('ja')
    flushSync()
    expect(shell.setTrayLabels).toHaveBeenLastCalledWith({
      show: 'show ja',
      toggleLast: 'toggle ja',
      quit: 'quit',
    })
  })

  it('binds the stored hotkeys once at launch, and warns about one that is taken', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const s = started({
      hotkeys: { toggleLast: 'Mod+Shift+Space', showApp: 'Mod+Alt+T' },
      taken: ['Mod+Alt+T'],
    })
    const { hotkeys } = s.fake.platform
    expect(hotkeys.set.mock.calls).toEqual([
      ['toggleLast', 'Mod+Shift+Space'],
      ['showApp', 'Mod+Alt+T'],
    ])
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledTimes(1)
    })
    expect(String(warn.mock.calls[0]?.[0])).toContain('Mod+Alt+T')
    // Settings › Desktop shows what each came to as soon as it opens.
    expect(hotkeyStatus).toEqual({
      toggleLast: { combo: 'Mod+Shift+Space', result: 'ok' },
      showApp: { combo: 'Mod+Alt+T', result: 'taken' },
    })
    // A later change is Settings › Desktop's to register, not this.
    s.setDesktop({ hotkeys: { toggleLast: 'Mod+Shift+K' } })
    flushSync()
    expect(hotkeys.set).toHaveBeenCalledTimes(2)
  })

  it('leaves unbound hotkeys alone at launch', () => {
    const s = started()
    expect(s.fake.platform.hotkeys.set).not.toHaveBeenCalled()
  })

  it('toggles the last-used card from the hotkey and the tray; showApp is the platform’s', () => {
    const s = started()
    s.store.addTimer()
    s.store.addStopwatch() // selected
    s.store.timer('id1', timer.start) // a button on the first card
    flushSync()
    s.setNow(NOW + MINUTE)
    s.fake.press('toggleLast')
    expect(cards.findCard(s.store.list, 'id1')).toMatchObject({ timer: { phase: 'paused' } })
    s.fake.press('showApp')
    expect(cards.findCard(s.store.list, 'id1')).toMatchObject({ timer: { phase: 'paused' } })
    expect(cards.findCard(s.store.list, 'id2')).toMatchObject({ stopwatch: { phase: 'idle' } })
    s.fake.tray()
    expect(cards.findCard(s.store.list, 'id1')).toMatchObject({ timer: { phase: 'running' } })
  })

  it('follows starts made elsewhere, such as another window, for the last-used card', () => {
    const s = started()
    s.store.addTimer()
    s.store.addStopwatch()
    // The mini window started the stopwatch: its list arrives through the tab sync.
    s.store.stopwatch('id2', stopwatch.start)
    s.store.select('id1')
    flushSync()
    s.fake.tray()
    expect(cards.findCard(s.store.list, 'id2')).toMatchObject({ stopwatch: { phase: 'paused' } })
    expect(cards.findCard(s.store.list, 'id1')).toMatchObject({ timer: { phase: 'idle' } })
  })

  it('prints smoke lines when asked: ready, ringing with its lateness, and toggles', () => {
    const s = started({ smoke: true })
    const { shell } = s.fake.platform
    expect(shell.smokeMark).toHaveBeenCalledWith('main ready')
    s.store.addTimer(MINUTE)
    s.store.timer('id1', timer.start)
    flushSync()
    s.setNow(NOW + MINUTE + 40)
    s.store.settle(NOW + MINUTE + 40)
    flushSync()
    expect(shell.smokeMark).toHaveBeenLastCalledWith(
      `ringing card=id1 endedAt=${new Date(NOW + MINUTE).toISOString()} late=40ms`,
    )
    s.fake.press('toggleLast')
    expect(shell.smokeMark).toHaveBeenLastCalledWith('hotkey toggle-last')
    s.fake.tray()
    expect(shell.smokeMark).toHaveBeenLastCalledWith('tray toggle-last')
  })

  it('prints no smoke lines when told not to', () => {
    const s = started({ smoke: false })
    s.fake.press('toggleLast')
    expect(s.fake.platform.shell.smokeMark).not.toHaveBeenCalled()
  })

  it('stops reporting and listening when stopped, once', () => {
    const s = setup()
    const { activity } = s.fake.platform
    expect(s.fake.listening()).toEqual({ pressed: true, tray: true })
    s.stop()
    s.stop()
    expect(s.fake.listening()).toEqual({ pressed: false, tray: false })
    const calls = activity.setRunning.mock.calls.length
    s.store.addTimer()
    s.store.timer('id1', timer.start)
    flushSync()
    expect(activity.setRunning).toHaveBeenCalledTimes(calls)
  })

  it('does nothing on the web, where no service is supported', () => {
    const s = started({
      supported: false,
      hotkeys: { toggleLast: 'Mod+Shift+Space', showApp: null },
    })
    const { activity, hotkeys, shell } = s.fake.platform
    expect(activity.setRunning).not.toHaveBeenCalled()
    expect(activity.onToggleLast).not.toHaveBeenCalled()
    expect(hotkeys.set).not.toHaveBeenCalled()
    expect(hotkeys.onPressed).not.toHaveBeenCalled()
    expect(shell.setTrayLabels).not.toHaveBeenCalled()
  })
})
