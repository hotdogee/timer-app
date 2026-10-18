/**
 * The mini window's rules (spec › Card header, Mini window): its page's address and the card it
 * shows, which buttons a card gets there, and what its keys do. Pure.
 *
 * The mini window shows one card compactly: a timer gets Start or Pause (Resume, Dismiss), then
 * Reset or Restart, then `+1:00` while that adds time; a stopwatch gets Start or Pause (Resume),
 * Lap while running, and Reset. Keys follow the user's bindings for the same actions: Space starts
 * or pauses, Enter starts or dismisses, R resets, L laps, Esc closes the window.
 */
import { keymap, type cards, type Ms } from '../../core'

/** The path of the desktop mini window's page (`/mini?card=<id>`). */
export const MINI_PATH = '/mini'

/** The query parameter that names the card. */
export const MINI_CARD_PARAM = 'card'

/** How long "This card was deleted" shows before the mini window closes. */
export const DELETED_CLOSE_MS = 2000

/** What the quick-add button adds. */
export const MINI_ADD_MS: Ms = 60_000

/** The card id in the page's query string (`?card=<id>`), or null when there is none. */
export function miniCardId(search: string): string | null {
  const id = new URLSearchParams(search).get(MINI_CARD_PARAM)?.trim() ?? ''
  return id === '' ? null : id
}

/** The page of the mini window for card `id`, relative to the app's root. */
export function miniPath(id: string): string {
  return `${MINI_PATH}?${new URLSearchParams({ [MINI_CARD_PARAM]: id }).toString()}`
}

/** A button of the mini window. */
export type MiniControl =
  'start' | 'pause' | 'resume' | 'dismiss' | 'reset' | 'restart' | 'add' | 'lap'

/** The buttons for `card` in its current phase, in order. */
export function miniControls(card: cards.Card): readonly MiniControl[] {
  if (card.kind === 'timer') {
    const t = card.timer
    switch (t.phase) {
      case 'idle':
        return ['start', 'add']
      case 'running':
        return ['pause', 'reset', 'add']
      case 'paused':
        return ['resume', 'reset', 'add']
      case 'ringing':
        return ['dismiss', 'restart']
    }
  }
  switch (card.stopwatch.phase) {
    case 'idle':
      return ['start']
    case 'running':
      return ['pause', 'lap', 'reset']
    case 'paused':
      return ['resume', 'reset']
  }
}

/** What a key does in the mini window. */
export type MiniKey = 'toggle' | 'start' | 'dismiss' | 'reset' | 'lap' | 'close'

const KEY_ACTIONS: Partial<Readonly<Record<keymap.ActionId, MiniKey>>> = {
  toggle: 'toggle',
  start: 'start',
  dismiss: 'dismiss',
  reset: 'reset',
  lap: 'lap',
  cancel: 'close',
}

/**
 * What key event `event` does in the mini window under `bindings`, or null: the card actions the
 * mini window has, and Esc (the cancel action) to close it.
 */
export function miniKey(
  bindings: keymap.Bindings,
  event: keymap.ModifierStateEventLike,
  platform: keymap.Platform,
): MiniKey | null {
  const action = keymap.resolveAction(bindings, keymap.keyEventForMatching(event), platform)
  return action === null ? null : (KEY_ACTIONS[action] ?? null)
}
