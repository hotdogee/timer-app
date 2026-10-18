/**
 * The desktop's token store (M6, `createCredentialTokens`): the token in the OS credential store
 * with a copy in memory, the device store taking over where the OS store fails, the one-time move
 * of a device-store token (M5's) into the OS store, and the auth state waiting for the token to
 * load before it checks the session.
 */
import { describe, expect, it } from 'vitest'

import type { settings } from '../core'
import type { TokenStore as CredentialStore } from '../platform'
import {
  createAuthStore,
  createCredentialTokens,
  type AuthBackend,
  type AuthResult,
  type SessionReport,
  type TokenStore,
} from './auth.svelte'

const OS_TOKEN: settings.DeviceAuth = { token: 'os-token', expiresAt: 2_000_000_000_000 }
const OLD_TOKEN: settings.DeviceAuth = { token: 'm5-token', expiresAt: 1_900_000_000_000 }
const NEW_TOKEN: settings.DeviceAuth = { token: 'new-token', expiresAt: 2_100_000_000_000 }

/** Lets pending promise callbacks run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/**
 * A credential store in memory that records each call. `failAt` makes that call (and every one
 * after it) fail as the platform's does: `supported` turns false and the call resolves to its
 * "nothing happened" value. `hold` keeps `get` from answering until `release`.
 */
function fakeCredentials(
  initial: settings.DeviceAuth | null = null,
  options: { failAt?: number; hold?: boolean } = {},
) {
  const calls: string[] = []
  let value = initial
  let supported = true
  let release = (): void => undefined
  const held = options.hold
    ? new Promise<void>((resolve) => {
        release = resolve
      })
    : Promise.resolve()
  /** Records a call; false when it fails (from `failAt` on). */
  const call = (name: string): boolean => {
    calls.push(name)
    if (options.failAt !== undefined && calls.length >= options.failAt) supported = false
    return supported
  }
  const store: CredentialStore = {
    get supported() {
      return supported
    },
    async get() {
      await held
      return call('get') ? value : null
    },
    set(auth) {
      if (!call(`set ${auth.token}`)) return Promise.resolve(false)
      value = auth
      return Promise.resolve(true)
    },
    clear() {
      if (!call('clear')) return Promise.resolve(false)
      value = null
      return Promise.resolve(true)
    },
  }
  return {
    store,
    calls,
    get value() {
      return value
    },
    release: () => {
      release()
    },
  }
}

/** The device store's token group in memory, recording each write. */
function deviceTokens(initial: settings.DeviceAuth | null = null) {
  const writes: (settings.DeviceAuth | null)[] = []
  let value = initial
  const store: TokenStore = {
    get current() {
      return value
    },
    set(auth) {
      writes.push(auth)
      value = auth
    },
  }
  return { store, writes }
}

describe('createCredentialTokens', () => {
  it('reads the token from the OS store, once, and leaves the device store alone', async () => {
    const os = fakeCredentials(OS_TOKEN)
    const device = deviceTokens()
    const tokens = createCredentialTokens(os.store, device.store)
    expect(tokens.current).toBeNull()
    expect(os.calls).toEqual([])
    const loading = tokens.load?.()
    expect(tokens.load?.()).toBe(loading)
    await loading
    expect(tokens.current).toEqual(OS_TOKEN)
    expect(os.calls).toEqual(['get'])
    expect(device.writes).toEqual([])
  })

  it('keeps new tokens in the OS store and removes them from both stores', async () => {
    const os = fakeCredentials()
    const device = deviceTokens()
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    tokens.set(NEW_TOKEN)
    expect(tokens.current).toEqual(NEW_TOKEN)
    await flush()
    expect(os.value).toEqual(NEW_TOKEN)
    tokens.set(null)
    expect(tokens.current).toBeNull()
    await flush()
    expect(os.value).toBeNull()
    expect(os.calls).toEqual(['get', 'set new-token', 'clear'])
    expect(device.writes).toEqual([])
  })

  it("moves the device store's token (M5's) into the OS store once, and clears it there", async () => {
    const os = fakeCredentials()
    const device = deviceTokens(OLD_TOKEN)
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    expect(tokens.current).toEqual(OLD_TOKEN)
    expect(os.value).toEqual(OLD_TOKEN)
    expect(device.store.current).toBeNull()
    expect(device.writes).toEqual([null])

    // The next start finds it in the OS store only and writes nothing.
    const again = createCredentialTokens(os.store, device.store)
    await again.load?.()
    expect(again.current).toEqual(OLD_TOKEN)
    expect(os.calls).toEqual(['get', 'set m5-token', 'get'])
    expect(device.writes).toEqual([null])
  })

  it('lets the device store token, the newest written, replace one the OS store holds', async () => {
    const os = fakeCredentials(OS_TOKEN)
    const device = deviceTokens(NEW_TOKEN)
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    expect(tokens.current).toEqual(NEW_TOKEN)
    expect(os.value).toEqual(NEW_TOKEN)
    expect(device.store.current).toBeNull()
  })

  it('keeps using the device store where the OS store is unavailable', async () => {
    const os = fakeCredentials(null, { failAt: 1 })
    const device = deviceTokens(OLD_TOKEN)
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    expect(tokens.current).toEqual(OLD_TOKEN)
    tokens.set(NEW_TOKEN)
    expect(tokens.current).toEqual(NEW_TOKEN)
    expect(device.store.current).toEqual(NEW_TOKEN)
    tokens.set(null)
    expect(tokens.current).toBeNull()
    expect(device.store.current).toBeNull()
    await flush()
    // Only the failed read reached the OS store.
    expect(os.calls).toEqual(['get'])
  })

  it('leaves the token in the device store when the OS store refuses the move', async () => {
    const os = fakeCredentials(null, { failAt: 2 })
    const device = deviceTokens(OLD_TOKEN)
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    expect(tokens.current).toEqual(OLD_TOKEN)
    expect(device.store.current).toEqual(OLD_TOKEN)
    expect(device.writes).toEqual([])
    tokens.set(NEW_TOKEN)
    expect(device.store.current).toEqual(NEW_TOKEN)
  })

  it('moves the latest token to the device store when an OS write fails', async () => {
    const os = fakeCredentials(null, { failAt: 2 })
    const device = deviceTokens()
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    tokens.set(NEW_TOKEN)
    expect(tokens.current).toEqual(NEW_TOKEN)
    await flush()
    expect(device.store.current).toEqual(NEW_TOKEN)
    expect(tokens.current).toEqual(NEW_TOKEN)
    tokens.set(OS_TOKEN)
    expect(device.store.current).toEqual(OS_TOKEN)
    await flush()
    expect(os.calls).toEqual(['get', 'set new-token'])
  })

  it('ends with the latest token in the device store when writes queued behind a failure fail', async () => {
    const os = fakeCredentials(null, { failAt: 2 })
    const device = deviceTokens()
    const tokens = createCredentialTokens(os.store, device.store)
    await tokens.load?.()
    tokens.set(NEW_TOKEN)
    tokens.set(null)
    await flush()
    expect(tokens.current).toBeNull()
    expect(device.store.current).toBeNull()
  })

  it('lets a sign-in or sign-out during the load win over what the load read', async () => {
    const os = fakeCredentials(OS_TOKEN, { hold: true })
    const device = deviceTokens(OLD_TOKEN)
    const tokens = createCredentialTokens(os.store, device.store)
    const loading = tokens.load?.()
    tokens.set(NEW_TOKEN)
    expect(tokens.current).toEqual(NEW_TOKEN)
    os.release()
    await loading
    await flush()
    expect(tokens.current).toEqual(NEW_TOKEN)
    expect(os.value).toEqual(NEW_TOKEN)
    // The device store's older token goes without being moved.
    expect(device.store.current).toBeNull()
    expect(os.calls).not.toContain('set m5-token')

    const signedOut = fakeCredentials(OS_TOKEN, { hold: true })
    const out = createCredentialTokens(signedOut.store, deviceTokens().store)
    const outLoading = out.load?.()
    out.set(null)
    signedOut.release()
    await outLoading
    await flush()
    expect(out.current).toBeNull()
    expect(signedOut.value).toBeNull()
  })
})

const ANN = { id: 'u1', email: 'ann@example.com', name: 'Ann', image: null }
const OK: AuthResult = { ok: true, value: undefined }

/** A backend that records when the session is watched and checked. */
function fakeBackend() {
  const events: string[] = []
  let listener: ((report: SessionReport) => void) | null = null
  const backend: AuthBackend = {
    watchSession: (next) => {
      events.push('watch')
      listener = next
      return () => {
        events.push('unwatch')
        listener = null
      }
    },
    refreshSession: () => {
      events.push('refresh')
      return Promise.resolve()
    },
    sendCode: () => Promise.resolve(OK),
    verifyCode: () => Promise.resolve({ ok: true, value: { user: ANN, token: 't' } }),
    signInSocial: () => Promise.resolve(OK),
    signOut: () => Promise.resolve(OK),
    deleteUser: () => Promise.resolve(OK),
    loadConfig: () => Promise.resolve(null),
  }
  return {
    backend,
    events,
    report: (report: SessionReport) => {
      listener?.(report)
    },
  }
}

describe('the auth state with a token store that loads', () => {
  function setup() {
    const os = fakeCredentials(OS_TOKEN, { hold: true })
    const tokens = createCredentialTokens(os.store, deviceTokens().store)
    const { backend, events, report } = fakeBackend()
    const store = createAuthStore({ backend, cache: null, page: null, tokens })
    return { os, tokens, store, events, report }
  }

  it('checks the session only once the token is loaded, so a "nobody" cannot drop it', async () => {
    const { os, tokens, store, events, report } = setup()
    store.start()
    await flush()
    expect(events).toEqual([])
    os.release()
    await flush()
    expect(events).toEqual(['watch'])
    report({ kind: 'signed-in', user: ANN, expiresAt: OS_TOKEN.expiresAt })
    expect(store.status).toBe('signed-in')
    expect(tokens.current).toEqual(OS_TOKEN)
  })

  it('refreshes the session only once the token is loaded', async () => {
    const { os, store, events } = setup()
    const refreshed = store.refresh()
    await flush()
    expect(events).toEqual([])
    os.release()
    await refreshed
    expect(events).toEqual(['refresh'])
  })

  it('never watches when stopped before the token is loaded', async () => {
    const { os, store, events } = setup()
    const stop = store.start()
    stop()
    os.release()
    await flush()
    expect(events).toEqual([])
    // Started again, it watches once the load is done.
    store.start()
    await flush()
    expect(events).toEqual(['watch'])
  })

  it('watches at once with a token store that needs no loading', () => {
    const { backend, events } = fakeBackend()
    const store = createAuthStore({
      backend,
      cache: null,
      page: null,
      tokens: deviceTokens().store,
    })
    store.start()
    expect(events).toEqual(['watch'])
  })
})
