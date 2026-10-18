/** The mini window through the shell (`src-tauri/src/mini.rs`). */
import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { getAllWindows } from '@tauri-apps/api/window'

import { onWindowEvent, windowLabel } from './events'

/** The mini window's label. */
export const MINI_WINDOW = 'mini'

/** Sent to the mini window when it should show another card. Payload: the card id. */
export const MINI_CARD = 'mini-card'

/** Sent to the main window when the mini window has closed, however that happened. */
export const MINI_CLOSED = 'mini-closed'

/**
 * Command `open_mini`: opens the mini window on `card`, or switches the open one to it and
 * focuses it.
 */
export function openMini(card: string, alwaysOnTop: boolean): Promise<void> {
  return invoke('open_mini', { card, alwaysOnTop })
}

/** Command `close_mini`: closes the mini window if it is open. */
export function closeMini(): Promise<void> {
  return invoke('close_mini')
}

/** Command `set_mini_always_on_top`: makes the open mini window float above other apps or not. */
export function setMiniAlwaysOnTop(flag: boolean): Promise<void> {
  return invoke('set_mini_always_on_top', { flag })
}

/** The label of the window that opens the mini window (`tauri.conf.json`). */
const MAIN_WINDOW = 'main'

/**
 * Follows the mini window from the main window: calls `setOpen(false)` when it closes, however
 * that happened, and `setOpen(true)` at once when it is open already (it may have opened before
 * this page loaded). The mini window's own page follows nothing (it may only close and pin
 * itself, `capabilities/mini.json`).
 */
export async function trackMini(setOpen: (open: boolean) => void): Promise<void> {
  if (windowLabel() !== MAIN_WINDOW) return
  await onWindowEvent(MINI_CLOSED, () => {
    setOpen(false)
  })
  const windows = await getAllWindows()
  if (windows.some((window) => window.label === MINI_WINDOW)) setOpen(true)
}

/** In the mini window: calls `listener` with the card id each time the shell switches its card. */
export function onMiniCard(listener: (cardId: string) => void): Promise<UnlistenFn> {
  return onWindowEvent(MINI_CARD, (card) => {
    if (typeof card === 'string' && card !== '') listener(card)
  })
}
