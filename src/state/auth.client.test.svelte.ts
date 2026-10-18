import { flushSync } from 'svelte'
import { describe, expect, it, vi } from 'vitest'

import type { RemoteSync } from '../sync/remote.svelte'
import { followAccount } from '../sync/remote.svelte'
import {
  createAuthStore,
  type AccountUser,
  type AuthBackend,
  type AuthResult,
  type SessionReport,
} from './auth.svelte'

const ANN: AccountUser = { id: 'u1', email: 'ann@example.com', name: 'Ann', image: null }
const OK: AuthResult = { ok: true, value: undefined }

/** The auth state over a scripted backend, followed by a recording sync and clock. */
function setup() {
  let report: (next: SessionReport) => void = () => undefined
  const backend: AuthBackend = {
    watchSession: (listener) => {
      report = listener
      return () => undefined
    },
    refreshSession: () => Promise.resolve(),
    sendCode: () => Promise.resolve(OK),
    verifyCode: () => Promise.resolve({ ok: true, value: { user: ANN, token: null } }),
    signInSocial: () => Promise.resolve(OK),
    signOut: () => Promise.resolve(OK),
    deleteUser: () => Promise.resolve(OK),
    loadConfig: () => Promise.resolve(null),
  }
  const store = createAuthStore({ backend, cache: null, page: null })
  const calls: string[] = []
  const remote: RemoteSync = {
    status: 'off',
    lastSyncAt: null,
    start: () => {
      calls.push('start')
    },
    stop: () => {
      calls.push('stop')
      return Promise.resolve()
    },
    reconnect: () => {
      calls.push('reconnect')
    },
  }
  const clock = { start: vi.fn(), stop: vi.fn(), measure: vi.fn(() => Promise.resolve()) }
  store.start()
  const unfollow = followAccount(() => store.user?.id ?? null, remote, clock)
  flushSync()
  return { store, report: (next: SessionReport) => report(next), calls, clock, unfollow }
}

/** Lets the clock measurement that sync waits for resolve, then flushes effects. */
async function measured(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve()
  flushSync()
}

describe('the auth state drives the sync connection', () => {
  it('starts sync on sign-in with a code and stops it on sign-out', async () => {
    const { store, calls, clock, unfollow } = setup()
    expect(calls).toEqual([])
    await store.verifyCode('ann@example.com', '123456')
    flushSync()
    await measured()
    expect(calls).toEqual(['start'])
    expect(clock.start).toHaveBeenCalledTimes(1)
    await store.signOut()
    flushSync()
    expect(calls).toEqual(['start', 'stop'])
    expect(clock.stop).toHaveBeenCalledTimes(1)
    unfollow()
  })

  it('keeps one connection across session checks of the same account', async () => {
    const { report, calls, unfollow } = setup()
    report({ kind: 'signed-in', user: ANN })
    flushSync()
    await measured()
    report({ kind: 'signed-in', user: { ...ANN } })
    report({ kind: 'unreachable' })
    report({ kind: 'pending' })
    flushSync()
    expect(calls).toEqual(['start'])
    // Another tab signed out: the session check says so.
    report({ kind: 'signed-out' })
    flushSync()
    expect(calls).toEqual(['start', 'stop'])
    unfollow()
  })

  it('stops after the account is deleted', async () => {
    const { store, report, calls, unfollow } = setup()
    report({ kind: 'signed-in', user: ANN })
    flushSync()
    await measured()
    await store.deleteAccount()
    flushSync()
    expect(calls).toEqual(['start', 'stop'])
    unfollow()
  })
})

describe('auth actions inside effects', () => {
  it('can be started from an effect without making it rerun', async () => {
    const { store, unfollow } = setup()
    let runs = 0
    const stop = $effect.root(() => {
      $effect(() => {
        runs++
        void store.sendCode('ann@example.com')
      })
    })
    flushSync()
    await Promise.resolve()
    flushSync()
    expect(runs).toBe(1)
    stop()
    unfollow()
  })
})
