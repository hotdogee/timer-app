/** Global hotkeys through the global-shortcut plugin. */
import { register, unregister, unregisterAll } from '@tauri-apps/plugin-global-shortcut'

import type { HotkeyId, HotkeyResult } from '../types'
import { errorText, registerFailure, toAccelerator } from './accelerator'
import { toggleWindow } from './main-window'

/** A failed call that says the plugin cannot be used at all (missing, or not permitted). */
const PLUGIN_GONE = /not allowed|not found/i

/** Binds the global hotkeys; one instance per service (it remembers what it registered). */
export interface HotkeyBinder {
  /**
   * Binds `id` to `combo` (portable binding text) after releasing its previous combo; null only
   * releases. Resolves to `'ok'`, `'taken'` or `'invalid'`; an error the OS gives that says
   * neither is `'invalid'` too (with a warning), so one refused combo never stops the binder from
   * releasing the others. Rejects only when the plugin itself is gone.
   */
  set(id: HotkeyId, combo: string | null): Promise<HotkeyResult>
}

/**
 * The global hotkeys, calling `press` with the hotkey's id each time one goes down (releasing it
 * calls nothing). `showApp` first shows and focuses the main window, or hides it when it has the
 * focus. Calls to `set` run one after another, so releases and registrations never interleave.
 */
export function createHotkeyBinder(press: (id: HotkeyId) => void): HotkeyBinder {
  /** The accelerator each hotkey holds now. */
  const bound = new Map<HotkeyId, string>()
  let queue: Promise<unknown> = Promise.resolve()
  let releasedEarlier: Promise<void> | null = null

  const pressed = (id: HotkeyId): void => {
    const shown =
      id === 'showApp'
        ? toggleWindow().catch((error: unknown) => {
            console.warn('Timer App: could not show or hide the window', error)
          })
        : Promise.resolve()
    void shown.then(() => {
      press(id)
    })
  }

  async function bind(id: HotkeyId, combo: string | null): Promise<HotkeyResult> {
    // The shell keeps an earlier load's registrations across reloads; they would read as taken.
    await (releasedEarlier ??= unregisterAll().catch(() => undefined))
    const previous = bound.get(id)
    if (previous !== undefined) {
      bound.delete(id)
      // Best effort: should the release fail, its presses are ignored below.
      await unregister(previous).catch(() => undefined)
    }
    if (combo === null) return 'ok'
    const accelerator = toAccelerator(combo)
    if (accelerator === null) return 'invalid'
    if ([...bound.values()].includes(accelerator)) return 'taken'
    try {
      await register(accelerator, (event) => {
        if (event.state === 'Pressed' && bound.get(id) === accelerator) pressed(id)
      })
    } catch (error) {
      const result = registerFailure(error)
      if (result !== null) return result
      // The plugin is missing or not permitted: nothing will register (the service turns off).
      if (PLUGIN_GONE.test(errorText(error))) throw error
      // Some other OS error for this combo: refuse it, and keep the other hotkeys working.
      console.warn(`Timer App: the OS refused the global hotkey ${accelerator}`, error)
      return 'invalid'
    }
    bound.set(id, accelerator)
    return 'ok'
  }

  return {
    set(id, combo) {
      const result = queue.then(() => bind(id, combo))
      queue = result.catch(() => undefined)
      return result
    },
  }
}
