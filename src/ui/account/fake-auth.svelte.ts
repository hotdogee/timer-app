/**
 * A fake auth state for the account UI's tests: reactive like `authStore`, with actions that
 * resolve to whether they worked and leave the reason in `error`, as the real store does. The
 * email code `123456` signs in; any other is wrong. Not part of the app.
 */
import { vi } from 'vitest'

import type { Provider } from '../../sync/protocol'
import type { AccountAuth, AccountUser, AuthError, AuthStatus } from './types'

/** The code the fake accepts. */
export const GOOD_CODE = '123456'

/** How the fake answers; change `next` before an action to make it fail. */
export interface FakeAuthOptions {
  readonly status?: AuthStatus
  readonly user?: AccountUser | null
  readonly providers?: readonly Provider[]
}

export function createFakeAuth(options: FakeAuthOptions = {}) {
  const state = $state({
    status: options.status ?? 'signed-out',
    user: options.user ?? null,
    providers: options.providers ?? ([] as readonly Provider[]),
    error: null as AuthError | null,
  })
  /** The error the next action fails with, if any; cleared once used. */
  const next: { error: AuthError | null } = { error: null }
  /** Resolves pending actions when set: lets a test look at the "…ing" state. */
  const gate: { wait: Promise<void> | null } = { wait: null }

  async function run(work: () => boolean): Promise<boolean> {
    state.error = null
    if (gate.wait) await gate.wait
    if (next.error !== null) {
      state.error = next.error
      next.error = null
      return false
    }
    const ok = work()
    if (!ok) state.error = 'invalid-code'
    return ok
  }

  const actions = {
    sendCode: vi.fn<(email: string) => Promise<boolean>>(() => run(() => true)),
    verifyCode: vi.fn((email: string, code: string) =>
      run(() => {
        if (code !== GOOD_CODE) return false
        state.user = { id: 'u1', email, name: null, image: null }
        state.status = 'signed-in'
        return true
      }),
    ),
    signInWith: vi.fn<(provider: Provider) => Promise<boolean>>(() => run(() => true)),
    signOut: vi.fn(() =>
      run(() => {
        state.user = null
        state.status = 'signed-out'
        return true
      }),
    ),
    deleteAccount: vi.fn(() =>
      run(() => {
        state.user = null
        state.status = 'signed-out'
        return true
      }),
    ),
    refresh: vi.fn(() => Promise.resolve()),
  }

  const auth: AccountAuth = {
    get status() {
      return state.status
    },
    get user() {
      return state.status === 'signed-in' ? state.user : null
    },
    get providers() {
      return state.providers
    },
    get error() {
      return state.error
    },
    ...actions,
  }

  return { auth, state, next, gate, ...actions }
}
