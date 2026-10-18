/**
 * The desktop sign-in's token in the OS credential store (M6), through the shell's `token_get`,
 * `token_set` and `token_clear` (`src-tauri/src/token_store.rs`). The first call loads
 * `@tauri-apps/api/core` through dynamic `import()`, so the web bundle carries none of it.
 *
 * Calls run one at a time, in the order made: a sign-out right after a sign-in clears the token
 * the sign-in stored. As everywhere in `src/platform`, nothing rejects: a failed call (the store
 * unavailable, locked or refusing) logs one `console.warn` and turns the store off for good, so
 * the app keeps the token in its device store from then on (see {@link TokenStore}).
 */
import type { invoke as Invoke } from '@tauri-apps/api/core'

import { migrateDeviceAuth } from '../../core/settings'
import type { TokenStore } from '../types'

/** Loads the shell's `invoke`; tests may pass another. */
export type LoadInvoke = () => Promise<typeof Invoke>

const loadInvoke: LoadInvoke = () => import('@tauri-apps/api/core').then((core) => core.invoke)

/** The token store over the shell's commands. Free of side effects until first used. */
export function createTauriTokenStore(load: LoadInvoke = loadInvoke): TokenStore {
  let off = false
  let loading: Promise<typeof Invoke> | undefined
  /** The last call queued; the next one starts when it has settled. */
  let queue: Promise<unknown> = Promise.resolve()

  /** Queues `task`; resolves to its result, or to `fallback` when the store is (or turns) off. */
  function run<R>(task: (invoke: typeof Invoke) => Promise<R>, fallback: R): Promise<R> {
    const result = queue.then(async () => {
      if (off) return fallback
      try {
        return await task(await (loading ??= load()))
      } catch (error) {
        if (!off) {
          off = true
          console.warn(
            'Timer App: the OS credential store failed and is off from now on; the sign-in ' +
              "token stays in the app's own storage",
            error,
          )
        }
        return fallback
      }
    })
    queue = result
    return result
  }

  return {
    get supported() {
      return !off
    },
    // An entry that is not a valid token reads as none (the shell checks too).
    get: () => run(async (invoke) => migrateDeviceAuth(await invoke<unknown>('token_get')), null),
    set: (auth) =>
      run(async (invoke) => {
        await invoke('token_set', { auth: { token: auth.token, expiresAt: auth.expiresAt } })
        return true
      }, false),
    clear: () =>
      run(async (invoke) => {
        await invoke('token_clear')
        return true
      }, false),
  }
}
