/**
 * The desktop sign-in in the auth state: the device authorization flow (a code, polling at the
 * server's interval, slow-down, refusal, expiry, cancel, an unreachable server), the bearer token
 * it stores (and the emailed-code sign-in's), the token's expiry following the session checks,
 * and the token going away on sign-out, deletion and a session the server no longer knows. Also
 * the Better Auth backend's device endpoints over a fake `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { settings } from '../core'
import {
  DEFAULT_SESSION_MS,
  TOKEN_GRACE_MS,
  createAppAuthClient,
  createAuthStore,
  createBetterAuthBackend,
  devicePoll,
  parseDeviceCode,
  usableToken,
  verificationUrlFor,
  type AccountUser,
  type AuthBackend,
  type AuthResult,
  type DeviceCode,
  type DevicePoll,
  type SessionReport,
  type TokenStore,
} from './auth.svelte'

const ANN: AccountUser = { id: 'u1', email: 'ann@example.com', name: 'Ann', image: null }
const OK: AuthResult = { ok: true, value: undefined }
const START = Date.UTC(2026, 9, 18, 12, 0, 0)

const CODE: DeviceCode = {
  deviceCode: 'secret-device-code',
  userCode: 'ABCDEFGH',
  verificationUrl: 'http://localhost:5173/device?user_code=ABCDEFGH',
  expiresIn: 900,
  interval: 5,
}

/** An in-memory token store that records every write. */
function memoryTokens(initial: settings.DeviceAuth | null = null) {
  const writes: (settings.DeviceAuth | null)[] = []
  const store: TokenStore & { value: settings.DeviceAuth | null } = {
    value: initial,
    get current() {
      return this.value
    },
    set(auth) {
      writes.push(auth)
      this.value = auth
    },
  }
  return { store, writes }
}

/** A backend whose device answers the test scripts, one per poll. */
function deviceBackend(
  polls: DevicePoll[],
  code: AuthResult<DeviceCode> = { ok: true, value: CODE },
) {
  let listener: ((report: SessionReport) => void) | null = null
  const backend = {
    watchSession: (next: (report: SessionReport) => void) => {
      listener = next
      return () => {
        listener = null
      }
    },
    refreshSession: vi.fn(() => Promise.resolve()),
    sendCode: vi.fn(() => Promise.resolve(OK)),
    verifyCode: vi.fn(() =>
      Promise.resolve({ ok: true as const, value: { user: ANN, token: 'emailed-token' } }),
    ),
    signInSocial: vi.fn(() => Promise.resolve(OK)),
    signOut: vi.fn(() => Promise.resolve(OK)),
    deleteUser: vi.fn(() => Promise.resolve(OK)),
    loadConfig: vi.fn(() => Promise.resolve(null)),
    requestDeviceCode: vi.fn(() => Promise.resolve(code)),
    pollDeviceToken: vi.fn((deviceCode: string) => {
      void deviceCode
      return Promise.resolve(polls.shift() ?? ({ kind: 'pending' } as const))
    }),
  } satisfies AuthBackend
  return {
    backend,
    report: (report: SessionReport) => {
      listener?.(report)
    },
  }
}

function setup(polls: DevicePoll[] = [], code?: AuthResult<DeviceCode>) {
  const { backend, report } = deviceBackend(polls, code)
  const tokens = memoryTokens()
  const store = createAuthStore({
    backend,
    cache: null,
    page: null,
    tokens: tokens.store,
    clock: () => Date.now(),
  })
  return { store, backend, report, tokens }
}

/** Lets pending promise callbacks run, under fake timers. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(START)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop sign-in through the browser', () => {
  it('shows the code, polls at the interval and signs in with the token', async () => {
    const { store, backend, tokens } = setup([
      { kind: 'pending' },
      { kind: 'granted', token: 'device-token', expiresIn: 2_592_000 },
    ])
    const started = store.startDeviceSignIn()
    expect(store.device).toEqual({ phase: 'requesting' })
    await expect(started).resolves.toBe(true)
    expect(store.device).toEqual({
      phase: 'waiting',
      userCode: 'ABCDEFGH',
      verificationUrl: 'http://localhost:5173/device?user_code=ABCDEFGH',
      expiresAt: START + 900_000,
      retrying: false,
    })
    // Not before the interval.
    await vi.advanceTimersByTimeAsync(4999)
    expect(backend.pollDeviceToken).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.pollDeviceToken).toHaveBeenCalledWith('secret-device-code')
    expect(store.device?.phase).toBe('waiting')
    await vi.advanceTimersByTimeAsync(5000)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(2)
    expect(tokens.store.current).toEqual({
      token: 'device-token',
      expiresAt: START + 10_000 + 2_592_000_000,
    })
    expect(backend.refreshSession).toHaveBeenCalled()
    await flush()
    expect(store.device).toBeNull()
    expect(store.error).toBeNull()
  })

  it('waits five seconds longer after each slow-down', async () => {
    const { store, backend } = setup([{ kind: 'slow-down' }, { kind: 'slow-down' }])
    await store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(5000)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(9999)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(14_999)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(3)
    store.cancelDeviceSignIn()
  })

  it('ends on a refusal or an expired code, and stops polling', async () => {
    const refused = setup([{ kind: 'denied' }])
    await refused.store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(5000)
    expect(refused.store.device).toEqual({ phase: 'denied' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(refused.backend.pollDeviceToken).toHaveBeenCalledTimes(1)

    const expired = setup([{ kind: 'expired' }])
    await expired.store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(5000)
    expect(expired.store.device).toEqual({ phase: 'expired' })
    expect(expired.tokens.writes).toEqual([])
  })

  it('stops by itself once the code has expired', async () => {
    const { store, backend } = setup([], { ok: true, value: { ...CODE, expiresIn: 12 } })
    await store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.device).toEqual({ phase: 'expired' })
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(2)
  })

  it('keeps polling while the server cannot be reached, and says so', async () => {
    const { store } = setup([
      { kind: 'failed', error: 'network' },
      { kind: 'failed', error: 'network' },
      { kind: 'pending' },
    ])
    await store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.device).toMatchObject({ phase: 'waiting', retrying: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.device).toMatchObject({ phase: 'waiting', retrying: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.device).toMatchObject({ phase: 'waiting', retrying: false })
    store.cancelDeviceSignIn()
  })

  it('gives up on any other failure, with the reason in error', async () => {
    const { store } = setup([{ kind: 'failed', error: 'unknown' }])
    await store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.device).toBeNull()
    expect(store.error).toBe('unknown')
  })

  it('stops polling when cancelled, and a new start replaces the old run', async () => {
    const { store, backend } = setup()
    await store.startDeviceSignIn()
    store.cancelDeviceSignIn()
    expect(store.device).toBeNull()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(backend.pollDeviceToken).not.toHaveBeenCalled()

    await store.startDeviceSignIn()
    await store.startDeviceSignIn()
    await vi.advanceTimersByTimeAsync(5000)
    // Only the second run polls.
    expect(backend.pollDeviceToken).toHaveBeenCalledTimes(1)
    store.cancelDeviceSignIn()
  })

  it('reports a failed code request in error', async () => {
    const { store, backend } = setup([], { ok: false, error: 'rate-limited' })
    await expect(store.startDeviceSignIn()).resolves.toBe(false)
    expect(store.device).toBeNull()
    expect(store.error).toBe('rate-limited')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(backend.pollDeviceToken).not.toHaveBeenCalled()
  })

  it('cannot run without a token store (the web)', async () => {
    const { backend } = deviceBackend([])
    const store = createAuthStore({ backend, cache: null, page: null })
    await expect(store.startDeviceSignIn()).resolves.toBe(false)
    expect(store.error).toBe('unknown')
    expect(backend.requestDeviceCode).not.toHaveBeenCalled()
  })
})

describe('the bearer token', () => {
  it('keeps the token of an emailed-code sign-in, for the session lifetime until checked', async () => {
    const { store, tokens } = setup()
    await expect(store.verifyCode('ann@example.com', '123456')).resolves.toBe(true)
    expect(tokens.store.current).toEqual({
      token: 'emailed-token',
      expiresAt: START + DEFAULT_SESSION_MS,
    })
    expect(store.status).toBe('signed-in')
  })

  it('keeps no token on the web', async () => {
    const { backend } = deviceBackend([])
    const store = createAuthStore({ backend, cache: null, page: null })
    await expect(store.verifyCode('ann@example.com', '123456')).resolves.toBe(true)
    expect(store.user).toEqual(ANN)
  })

  it('follows the expiry the session checks report', () => {
    const { store, report, tokens } = setup()
    tokens.store.value = { token: 'tok', expiresAt: START + 1000 }
    store.start()
    report({ kind: 'signed-in', user: ANN, expiresAt: START + 5000 })
    expect(tokens.store.current).toEqual({ token: 'tok', expiresAt: START + 5000 })
    report({ kind: 'signed-in', user: ANN })
    report({ kind: 'signed-in', user: ANN, expiresAt: START + 5000 })
    expect(tokens.writes).toHaveLength(1)
  })

  it('forgets a token the server no longer knows, but not one kept moments ago', async () => {
    const { store, report, tokens } = setup()
    tokens.store.value = { token: 'old', expiresAt: START + 1000 }
    store.start()
    report({ kind: 'signed-out' })
    expect(tokens.store.current).toBeNull()

    await store.verifyCode('ann@example.com', '123456')
    // A check that was under way before the sign-in answers late.
    report({ kind: 'signed-out' })
    expect(tokens.store.current?.token).toBe('emailed-token')
    vi.setSystemTime(START + TOKEN_GRACE_MS + 1)
    report({ kind: 'signed-out' })
    expect(tokens.store.current).toBeNull()
  })

  it('removes the token on sign-out and account deletion, not on a failed deletion', async () => {
    const { store, backend, tokens } = setup()
    tokens.store.value = { token: 'tok', expiresAt: START + 1000 }
    await expect(store.signOut()).resolves.toBe(true)
    expect(tokens.store.current).toBeNull()
    tokens.store.value = { token: 'tok', expiresAt: START + 1000 }
    backend.deleteUser.mockResolvedValueOnce({ ok: false, error: 'network' })
    await expect(store.deleteAccount()).resolves.toBe(false)
    expect(tokens.store.current).not.toBeNull()
    await store.deleteAccount()
    expect(tokens.store.current).toBeNull()
  })

  it('signs out on this device when the server cannot be reached, revoking first', async () => {
    const { store, backend, tokens, report } = setup()
    store.start()
    report({ kind: 'signed-in', user: ANN })
    tokens.store.value = { token: 'tok', expiresAt: START + 1000 }
    let heldDuringRevoke: unknown = 'not asked'
    backend.signOut.mockImplementationOnce(() => {
      heldDuringRevoke = tokens.store.current
      return Promise.resolve({ ok: false, error: 'network' })
    })
    await expect(store.signOut()).resolves.toBe('device-only')
    // The revoke went out with the token; the token goes anyway, and so does the session here.
    expect(heldDuringRevoke).toEqual({ token: 'tok', expiresAt: START + 1000 })
    expect(tokens.store.current).toBeNull()
    expect(store.status).toBe('signed-out')
    expect(store.user).toBeNull()
    expect(store.error).toBeNull()
  })

  it('is usable only before it expires', () => {
    expect(usableToken(null, START)).toBeNull()
    expect(usableToken({ token: 't', expiresAt: START + 1 }, START)).toBe('t')
    expect(usableToken({ token: 't', expiresAt: START }, START)).toBeNull()
  })
})

describe('device flow answers', () => {
  it('reads a device code body, preferring the server approval page', () => {
    const body = {
      device_code: 'dc',
      user_code: 'WXYZ2345',
      verification_uri: 'https://timer.example/device',
      verification_uri_complete: 'https://timer.example/device?user_code=WXYZ2345',
      expires_in: 900,
      interval: 5,
    }
    expect(parseDeviceCode(body, 'http://localhost:8787')).toEqual({
      deviceCode: 'dc',
      userCode: 'WXYZ2345',
      verificationUrl: 'https://timer.example/device?user_code=WXYZ2345',
      expiresIn: 900,
      interval: 5,
    })
    expect(parseDeviceCode({ ...body, interval: undefined }, '')?.interval).toBe(5)
    expect(parseDeviceCode({ ...body, device_code: '' }, '')).toBeNull()
    expect(parseDeviceCode({ ...body, expires_in: 0 }, '')).toBeNull()
    expect(parseDeviceCode('nope', '')).toBeNull()
  })

  it('builds the approval page on the API origin when the server gives none or a bad one', () => {
    expect(verificationUrlFor('AB CD', undefined, 'http://localhost:8787')).toBe(
      'http://localhost:8787/device?user_code=AB+CD',
    )
    expect(verificationUrlFor('ABCD', 'javascript:alert(1)', 'https://t.example')).toBe(
      'https://t.example/device?user_code=ABCD',
    )
    expect(verificationUrlFor('ABCD', 'not a url', '')).toBe('/device?user_code=ABCD')
  })

  it('maps token poll answers', () => {
    const err = (error: string, status = 400) => ({ status, error, error_description: '' })
    expect(devicePoll(null, err('authorization_pending'))).toEqual({ kind: 'pending' })
    expect(devicePoll(null, err('slow_down'))).toEqual({ kind: 'slow-down' })
    expect(devicePoll(null, err('access_denied'))).toEqual({ kind: 'denied' })
    expect(devicePoll(null, err('expired_token'))).toEqual({ kind: 'expired' })
    expect(devicePoll(null, { status: 429 })).toEqual({ kind: 'slow-down' })
    expect(devicePoll(null, { status: 502 })).toEqual({ kind: 'failed', error: 'network' })
    expect(devicePoll(null, err('invalid_grant'))).toEqual({ kind: 'failed', error: 'unknown' })
    expect(devicePoll({ access_token: 'tok', expires_in: 60 }, null)).toEqual({
      kind: 'granted',
      token: 'tok',
      expiresIn: 60,
    })
    expect(devicePoll({ access_token: '' }, null)).toEqual({ kind: 'failed', error: 'unknown' })
  })
})

describe('the Better Auth backend, device endpoints', () => {
  interface Recorded {
    readonly url: string
    readonly body: unknown
    readonly headers: Headers
    readonly credentials: RequestCredentials | undefined
  }

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  function setupClient(respond: () => Response | Promise<Response>) {
    vi.useRealTimers()
    const requests: Recorded[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      requests.push({
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
      })
      return respond()
    }) as typeof fetch
    const client = createAppAuthClient({
      baseURL: 'http://localhost:8787',
      fetch: fetchImpl,
      tokenProvider: () => null,
    })
    return { backend: createBetterAuthBackend(client, { fetch: fetchImpl }), requests }
  }

  it('asks for a code as the desktop client, without credentials', async () => {
    const { backend, requests } = setupClient(() =>
      json({
        device_code: 'dc',
        user_code: 'ABCDEFGH',
        verification_uri: 'http://localhost:5173/device',
        verification_uri_complete: 'http://localhost:5173/device?user_code=ABCDEFGH',
        expires_in: 900,
        interval: 5,
      }),
    )
    const result = await backend.requestDeviceCode()
    expect(result).toEqual({
      ok: true,
      value: {
        deviceCode: 'dc',
        userCode: 'ABCDEFGH',
        verificationUrl: 'http://localhost:5173/device?user_code=ABCDEFGH',
        expiresIn: 900,
        interval: 5,
      },
    })
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:8787/api/auth/device/code',
      body: { client_id: 'timer-app-desktop' },
      credentials: 'omit',
    })
  })

  it('polls with the device code grant and reads the answer', async () => {
    const answers = [
      () =>
        json({ error: 'authorization_pending', error_description: 'Authorization pending' }, 400),
      () => json({ error: 'slow_down', error_description: 'Polling too frequently' }, 400),
      () => json({ access_token: 'tok', token_type: 'Bearer', expires_in: 60, scope: '' }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]
    let next = 0
    const { backend, requests } = setupClient(() => (answers[next++] ?? (() => json({})))())
    const results: DevicePoll[] = []
    for (let i = 0; i < 4; i++) results.push(await backend.pollDeviceToken('dc'))
    expect(results).toEqual([
      { kind: 'pending' },
      { kind: 'slow-down' },
      { kind: 'granted', token: 'tok', expiresIn: 60 },
      { kind: 'failed', error: 'network' },
    ])
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:8787/api/auth/device/token',
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'dc',
        client_id: 'timer-app-desktop',
      },
    })
  })
})
