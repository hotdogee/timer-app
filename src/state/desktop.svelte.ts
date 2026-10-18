/**
 * The desktop app's wiring (M5): what the main window tells the shell, and what the shell asks of
 * it. Only the main window runs it (`App.svelte`); the mini window's page never does, since the
 * shell takes these reports from the main window only.
 *
 * - Activity: whether any card is running or ringing, on every change, and the close behavior
 *   setting, so closing the window hides the app to the tray while a timer runs (spec Q11).
 * - Tray: the menu's labels in the app's language (again on every language change), and its
 *   "Start or pause the last card", which does what the `toggleLast` hotkey does.
 * - Global hotkeys: registered once at launch from Settings › Desktop (the section registers its
 *   own changes); `toggleLast` starts or pauses the last-used card without focusing the window.
 *   `showApp` needs nothing here: the platform shows or hides the window itself. What each
 *   registration came to goes to `hotkeyStatus`, so the section shows a combo another app holds as
 *   soon as it opens (and tries it again then).
 * - The smoke hook (development builds of the desktop app): `[smoke]` lines on the shell's output
 *   when the app is ready, when a card starts ringing (with how late that was) and when a hotkey
 *   or the tray toggles a card, which `scripts/smoke-desktop.mjs` reads.
 *
 * On the web every one of these services is unsupported and nothing starts.
 */
import { untrack } from 'svelte'

import { cards, settings, type Clock } from '../core'
import type { HotkeyId, Platform, TrayLabels } from '../platform'
import { appClock } from './app-clock'
import { bindHotkey } from './hotkey-status.svelte'

/** The platform services the wiring uses. */
export type DesktopPlatform = Pick<Platform, 'activity' | 'hotkeys' | 'shell'>

/** What {@link startDesktop} works with. */
export interface DesktopDeps {
  readonly platform: DesktopPlatform
  /** The card list; a getter over reactive state (`() => cardStore.list`). */
  readonly list: () => cards.CardList
  /** Settings › Desktop; a getter over reactive state (`() => settingsStore.desktop`). */
  readonly desktop: () => settings.DesktopSettings
  /** The tray menu's labels, read in an effect: messages (`m.tray_show()`) follow the language. */
  readonly trayLabels: () => TrayLabels
  /** Starts or pauses the last-used card (the keyboard controller's `toggleLast`). */
  readonly toggleLast: () => void
  /**
   * Whether to print the smoke test's `[smoke]` lines (default true). Development builds only: a
   * production build has none of this code.
   */
  readonly smoke?: boolean | undefined
  /** The time, for the smoke lines; the app clock by default. */
  readonly clock?: Clock | undefined
}

/**
 * Whether the app has something going on that closing the window must not end: any card running
 * (a timer or a stopwatch) or a timer ringing.
 */
export function isActive(list: cards.CardList): boolean {
  return list.cards.some((card) =>
    card.kind === 'timer'
      ? card.timer.phase === 'running' || card.timer.phase === 'ringing'
      : card.stopwatch.phase === 'running',
  )
}

/** The timers ringing in `after` that were not ringing (or did not exist) in `before`. */
export function newlyRinging(before: cards.CardList, after: cards.CardList): cards.TimerCard[] {
  if (before === after) return []
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
  const old = new Map(before.cards.map((card) => [card.id, card]))
  const out: cards.TimerCard[] = []
  for (const card of after.cards) {
    if (card.kind !== 'timer' || card.timer.phase !== 'ringing') continue
    const previous = old.get(card.id)
    if (previous?.kind === 'timer' && previous.timer.phase === 'ringing') continue
    out.push(card)
  }
  return out
}

const noop = (): void => undefined

/**
 * Starts the desktop wiring (see the module comment) in an effect root of its own and returns the
 * function that stops it. Does nothing where the platform has no shell (the web).
 */
export function startDesktop(deps: DesktopDeps): () => void {
  const { activity, hotkeys, shell } = deps.platform
  if (!activity.supported && !hotkeys.supported && !shell.supported) return noop
  const smoke = import.meta.env.DEV && (deps.smoke ?? true) && shell.supported
  const clock = deps.clock ?? appClock
  const mark = (message: string): void => {
    if (smoke) shell.smokeMark(message)
  }

  const toggleLast = (source: 'hotkey' | 'tray'): void => {
    mark(`${source} toggle-last`)
    deps.toggleLast()
  }

  const stopEffects = $effect.root(() => {
    $effect(() => {
      activity.setRunning(isActive(deps.list()))
    })
    $effect(() => {
      activity.setCloseBehavior(deps.desktop().closeBehavior)
    })
    $effect(() => {
      shell.setTrayLabels(deps.trayLabels())
    })
    if (smoke) {
      let seen = untrack(deps.list)
      $effect(() => {
        const list = deps.list()
        untrack(() => {
          const now = clock()
          for (const card of newlyRinging(seen, list)) {
            if (card.timer.phase !== 'ringing') continue
            const { endedAt } = card.timer
            // eslint-disable-next-line svelte/prefer-svelte-reactivity -- formatting, not state
            const at = new Date(endedAt).toISOString()
            mark(
              `ringing card=${card.id} endedAt=${at} late=${String(Math.round(now - endedAt))}ms`,
            )
          }
          seen = list
        })
      })
    }
  })

  // Launch: bind the hotkeys the settings hold. A combo another app took since is left unbound;
  // Settings › Desktop says so (`hotkeyStatus`) and tries it again when it opens.
  if (hotkeys.supported) {
    const bound = untrack(deps.desktop).hotkeys
    for (const id of settings.HOTKEY_IDS) {
      const combo = bound[id]
      if (combo === null) continue
      void bindHotkey(hotkeys, id, combo).then((result) => {
        if (result !== 'ok') {
          console.warn(`Timer App: the global hotkey ${combo} (${id}) is not bound: ${result}`)
        }
      })
    }
  }
  const stopPresses = hotkeys.onPressed((id: HotkeyId) => {
    if (id === 'toggleLast') toggleLast('hotkey')
  })
  const stopTray = activity.onToggleLast(() => {
    toggleLast('tray')
  })
  mark('main ready')

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    stopEffects()
    stopPresses()
    stopTray()
  }
}
