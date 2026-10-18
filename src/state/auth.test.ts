import { describe, expect, it, vi } from 'vitest'

import {
  ACCOUNT_STORAGE_KEY,
  authErrorFor,
  createAccountCache,
  createAppAuthClient,
  createAuthStore,
  createBetterAuthBackend,
  parseConfig,
  sessionReport,
  toAccountUser,
  type AccountCache,
  type AccountUser,
  type AuthBackend,
  type AuthPage,
  type AuthResult,
  type SessionReport,
  type SignIn,
} from './auth.svelte'

const ANN: AccountUser = { id: 'u1', email: 'ann@example.com', name: 'Ann', image: null }
const BOB: AccountUser = { id: 'u2', email: 'bob@example.com', name: null, image: null }
const OK: AuthResult = { ok: true, value: undefined }

/** A backend whose answers the test scripts, and the session listener it was given. */
function fakeBackend(overrides: Partial<AuthBackend> = {}) {
  let listener: ((report: SessionReport) => void) | null = null
  let watching = 0
  const backend = {
    watchSession: (next: (report: SessionReport) => void) => {
      watching++
      listener = next
      return () => {
        watching--
        listener = null
      }
    },
    refreshSession: vi.fn(() => Promise.resolve()),
    sendCode: vi.fn(() => Promise.resolve(OK)),
    verifyCode: vi.fn(() =>
      Promise.resolve<AuthResult<SignIn>>({ ok: true, value: { user: ANN, token: 'tok-ann' } }),
    ),
    signInSocial: vi.fn(() => Promise.resolve(OK)),
    signOut: vi.fn(() => Promise.resolve(OK)),
    deleteUser: vi.fn(() => Promise.resolve(OK)),
    loadConfig: vi.fn(() =>
      Promise.resolve({ providers: ['google', 'github'] as const, appEnv: 'development' as const }),
    ),
  }
  return {
    backend: { ...backend, ...overrides },
    /** The default mocks, for expect(); an override replaces its mock in `backend` only. */
    mocks: backend,
    report: (report: SessionReport) => {
      listener?.(report)
    },
    watching: () => watching,
  }
}

/** An in-memory account cache. */
function memoryCache(
  initial: AccountUser | null = null,
): AccountCache & { value: AccountUser | null } {
  return {
    value: initial,
    read() {
      return this.value
    },
    write(user) {
      this.value = user
    },
  }
}

function fakePage(href = 'http://localhost:5173/'): AuthPage & { replaced: string[] } {
  const replaced: string[] = []
  return {
    location: { href },
    history: {
      state: null,
      replaceState: (_state, _unused, url) => {
        replaced.push(url)
      },
    },
    replaced,
  }
}

/** Waits for pending promise callbacks. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createAuthStore', () => {
  it('starts unknown with nothing cached, and talks to nobody before start', () => {
    const { backend, mocks, watching } = fakeBackend()
    const store = createAuthStore({ backend, cache: memoryCache(), page: null })
    expect(store.status).toBe('unknown')
    expect(store.user).toBeNull()
    expect(store.providers).toEqual([])
    expect(store.appEnv).toBeNull()
    expect(store.error).toBeNull()
    expect(store.busy).toBe(false)
    expect(watching()).toBe(0)
    expect(mocks.loadConfig).not.toHaveBeenCalled()
  })

  it('starts signed in as the cached account, so an offline start still syncs', () => {
    const { backend } = fakeBackend()
    const store = createAuthStore({ backend, cache: memoryCache(ANN), page: null })
    expect(store.status).toBe('signed-in')
    expect(store.user).toEqual(ANN)
  })

  it('follows the session once started, and caches the account', () => {
    const { backend, report } = fakeBackend()
    const cache = memoryCache()
    const store = createAuthStore({ backend, cache, page: null })
    store.start()
    report({ kind: 'pending' })
    expect(store.status).toBe('unknown')
    report({ kind: 'signed-in', user: ANN })
    expect(store.status).toBe('signed-in')
    expect(store.user).toEqual(ANN)
    expect(cache.value).toEqual(ANN)
    report({ kind: 'signed-out' })
    expect(store.status).toBe('signed-out')
    expect(store.user).toBeNull()
    expect(cache.value).toBeNull()
  })

  it('keeps what it knows when the session check cannot reach the server', () => {
    const { backend, report } = fakeBackend()
    const signedIn = createAuthStore({ backend, cache: memoryCache(ANN), page: null })
    signedIn.start()
    report({ kind: 'unreachable' })
    report({ kind: 'pending' })
    expect(signedIn.status).toBe('signed-in')
    expect(signedIn.user).toEqual(ANN)

    const other = fakeBackend()
    const unknown = createAuthStore({ backend: other.backend, cache: memoryCache(), page: null })
    unknown.start()
    other.report({ kind: 'unreachable' })
    expect(unknown.status).toBe('unknown')
  })

  it('keeps the same user object for an unchanged account, and takes a new one when it changes', () => {
    const { backend, report } = fakeBackend()
    const store = createAuthStore({ backend, cache: memoryCache(), page: null })
    store.start()
    report({ kind: 'signed-in', user: ANN })
    const first = store.user
    report({ kind: 'signed-in', user: { ...ANN } })
    expect(store.user).toBe(first)
    report({ kind: 'signed-in', user: BOB })
    expect(store.user).toEqual(BOB)
  })

  it('loads the providers and the server mode on start, and again on refresh after a failure', async () => {
    let answer: Awaited<ReturnType<AuthBackend['loadConfig']>> = null
    const loadConfig = vi.fn(() => Promise.resolve(answer))
    const { backend, mocks } = fakeBackend({ loadConfig })
    const store = createAuthStore({ backend, cache: null, page: null })
    store.start()
    await tick()
    expect(store.providers).toEqual([])
    answer = { providers: ['apple'], appEnv: 'production' }
    await store.refresh()
    expect(store.providers).toEqual(['apple'])
    expect(store.appEnv).toBe('production')
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1)
    await store.refresh()
    expect(loadConfig).toHaveBeenCalledTimes(2)
  })

  it('starts once, and stops following the session', () => {
    const { backend, watching, report } = fakeBackend()
    const store = createAuthStore({ backend, cache: null, page: null })
    const stop = store.start()
    expect(store.start()).toBe(stop)
    expect(watching()).toBe(1)
    stop()
    stop()
    expect(watching()).toBe(0)
    report({ kind: 'signed-in', user: ANN })
    expect(store.status).toBe('unknown')
    // And can start again.
    store.start()
    expect(watching()).toBe(1)
  })

  it('sends a code to the trimmed address, busy meanwhile', async () => {
    let finish: (result: AuthResult) => void = () => undefined
    const sendCode = vi.fn<AuthBackend['sendCode']>(
      () =>
        new Promise<AuthResult>((resolve) => {
          finish = resolve
        }),
    )
    const { backend } = fakeBackend({ sendCode })
    const store = createAuthStore({ backend, cache: null, page: null })
    const sending = store.sendCode('  ann@example.com ')
    expect(store.busy).toBe(true)
    expect(sendCode).toHaveBeenCalledWith('ann@example.com')
    finish(OK)
    await expect(sending).resolves.toBe(true)
    expect(store.busy).toBe(false)
    expect(store.error).toBeNull()
  })

  it('reports a failure in error and resolves to false, and the next action clears it', async () => {
    const { backend } = fakeBackend({
      sendCode: vi.fn(() => Promise.resolve<AuthResult>({ ok: false, error: 'rate-limited' })),
    })
    const store = createAuthStore({ backend, cache: null, page: null })
    await expect(store.sendCode('ann@example.com')).resolves.toBe(false)
    expect(store.error).toBe('rate-limited')
    expect(store.busy).toBe(false)
    const verifying = store.verifyCode('ann@example.com', '123456')
    expect(store.error).toBeNull()
    await verifying
    store.clearError()
    expect(store.error).toBeNull()
  })

  it('signs in with the code at once, without waiting for the session check', async () => {
    const { backend, mocks } = fakeBackend()
    const cache = memoryCache()
    const store = createAuthStore({ backend, cache, page: null })
    await expect(store.verifyCode(' ann@example.com', '123 456')).resolves.toBe(true)
    expect(mocks.verifyCode).toHaveBeenCalledWith('ann@example.com', '123456')
    expect(store.status).toBe('signed-in')
    expect(store.user).toEqual(ANN)
    expect(cache.value).toEqual(ANN)
  })

  it('checks the session when a sign-in answer has no user', async () => {
    const { backend, mocks } = fakeBackend({
      verifyCode: vi.fn(() =>
        Promise.resolve<AuthResult<SignIn>>({ ok: true, value: { user: null, token: null } }),
      ),
    })
    const store = createAuthStore({ backend, cache: null, page: null })
    await store.verifyCode('ann@example.com', '123456')
    expect(mocks.refreshSession).toHaveBeenCalled()
  })

  it('keeps a wrong code signed out', async () => {
    const { backend } = fakeBackend({
      verifyCode: vi.fn(() =>
        Promise.resolve<AuthResult<SignIn>>({ ok: false, error: 'invalid-code' }),
      ),
    })
    const store = createAuthStore({ backend, cache: null, page: null })
    await expect(store.verifyCode('ann@example.com', '000000')).resolves.toBe(false)
    expect(store.error).toBe('invalid-code')
    expect(store.status).toBe('unknown')
  })

  it('leaves for a provider with the current page as the way back', async () => {
    const { backend, mocks } = fakeBackend()
    const page = fakePage('http://localhost:5173/device?user_code=ABCD-EFGH')
    const store = createAuthStore({ backend, cache: null, page })
    await expect(store.signInWith('github')).resolves.toBe(true)
    expect(mocks.signInSocial).toHaveBeenCalledWith(
      'github',
      'http://localhost:5173/device?user_code=ABCD-EFGH',
    )
  })

  it('signs out, forgetting the cached account', async () => {
    const { backend } = fakeBackend()
    const cache = memoryCache(ANN)
    const store = createAuthStore({ backend, cache, page: null })
    await expect(store.signOut()).resolves.toBe(true)
    expect(store.status).toBe('signed-out')
    expect(store.user).toBeNull()
    expect(cache.value).toBeNull()
  })

  it('stays signed in when signing out cannot reach the server', async () => {
    const { backend } = fakeBackend({
      signOut: vi.fn(() => Promise.resolve<AuthResult>({ ok: false, error: 'network' })),
    })
    const store = createAuthStore({ backend, cache: memoryCache(ANN), page: null })
    await expect(store.signOut()).resolves.toBe(false)
    expect(store.status).toBe('signed-in')
    expect(store.error).toBe('network')
  })

  it('deletes the account and returns to signed out', async () => {
    const { backend, mocks } = fakeBackend()
    const cache = memoryCache(ANN)
    const store = createAuthStore({ backend, cache, page: null })
    await expect(store.deleteAccount()).resolves.toBe(true)
    expect(mocks.deleteUser).toHaveBeenCalledTimes(1)
    expect(store.status).toBe('signed-out')
    expect(cache.value).toBeNull()
  })

  it('asks for a fresh sign-in when the server wants one before deleting', async () => {
    const { backend } = fakeBackend({
      deleteUser: vi.fn(() => Promise.resolve<AuthResult>({ ok: false, error: 'session-expired' })),
    })
    const store = createAuthStore({ backend, cache: memoryCache(ANN), page: null })
    await expect(store.deleteAccount()).resolves.toBe(false)
    expect(store.error).toBe('session-expired')
    expect(store.status).toBe('signed-in')
  })

  it('picks up a failed provider sign-in from the URL on start and cleans the URL', () => {
    const { backend } = fakeBackend()
    const page = fakePage(
      'http://localhost:5173/device?user_code=ABCD&error=access_denied&error_description=Nope',
    )
    const store = createAuthStore({ backend, cache: null, page })
    store.start()
    expect(store.error).toBe('oauth')
    expect(page.replaced).toEqual(['http://localhost:5173/device?user_code=ABCD'])
  })

  it('leaves a URL without an error alone', () => {
    const { backend } = fakeBackend()
    const page = fakePage('http://localhost:5173/?user_code=ABCD')
    const store = createAuthStore({ backend, cache: null, page })
    store.start()
    expect(store.error).toBeNull()
    expect(page.replaced).toEqual([])
  })
})

describe('authErrorFor', () => {
  it('reads Better Auth error codes first, then the status', () => {
    expect(authErrorFor(400, 'INVALID_EMAIL')).toBe('invalid-email')
    expect(authErrorFor(400, 'INVALID_OTP')).toBe('invalid-code')
    expect(authErrorFor(400, 'OTP_EXPIRED')).toBe('expired-code')
    expect(authErrorFor(403, 'TOO_MANY_ATTEMPTS')).toBe('too-many-attempts')
    expect(authErrorFor(400, 'SESSION_EXPIRED')).toBe('session-expired')
    expect(authErrorFor(429)).toBe('rate-limited')
    // The server's limits on code emails, per address and per day.
    expect(authErrorFor(429, 'TOO_MANY_CODE_EMAILS')).toBe('too-many-codes')
    expect(authErrorFor(503, 'EMAIL_UNAVAILABLE')).toBe('unavailable')
    expect(authErrorFor(502)).toBe('network')
    expect(authErrorFor(0)).toBe('network')
    expect(authErrorFor(400, 'SOMETHING_ELSE')).toBe('unknown')
    expect(authErrorFor(404, null)).toBe('unknown')
  })
})

describe('toAccountUser', () => {
  it('keeps the id, email, name and picture, with blanks as null', () => {
    expect(
      toAccountUser({ id: 'u1', email: 'a@b.c', name: 'Ann', image: 'https://x/y.png', extra: 1 }),
    ).toEqual({ id: 'u1', email: 'a@b.c', name: 'Ann', image: 'https://x/y.png' })
    expect(toAccountUser({ id: 'u1', email: 'a@b.c', name: '  ', image: '' })).toEqual({
      id: 'u1',
      email: 'a@b.c',
      name: null,
      image: null,
    })
  })

  it('rejects what is not a user', () => {
    expect(toAccountUser(null)).toBeNull()
    expect(toAccountUser('u1')).toBeNull()
    expect(toAccountUser({ id: '', email: 'a@b.c' })).toBeNull()
    expect(toAccountUser({ id: 'u1' })).toBeNull()
  })
})

describe('sessionReport', () => {
  const user = { id: 'u1', email: 'a@b.c', name: '', image: null }

  it('is signed in with a user, pending while the first check runs', () => {
    expect(sessionReport({ data: { user }, error: null, isPending: false })).toEqual({
      kind: 'signed-in',
      user: { id: 'u1', email: 'a@b.c', name: null, image: null },
    })
    expect(sessionReport({ data: null, error: null, isPending: true })).toEqual({ kind: 'pending' })
  })

  it('is signed out on an empty answer or a 401, unreachable on any other failure', () => {
    expect(sessionReport({ data: null, error: null, isPending: false })).toEqual({
      kind: 'signed-out',
    })
    expect(sessionReport({ data: null, error: { status: 401 }, isPending: false })).toEqual({
      kind: 'signed-out',
    })
    expect(sessionReport({ data: null, error: { status: 502 }, isPending: false })).toEqual({
      kind: 'unreachable',
    })
    expect(
      sessionReport({ data: null, error: new TypeError('Failed to fetch'), isPending: false }),
    ).toEqual({ kind: 'unreachable' })
  })

  it('is pending while a check is under way, whatever the last answer was', () => {
    // After a sign-out the client checks again and, meanwhile, still holds the signed-in answer.
    expect(
      sessionReport({ data: { user }, error: null, isPending: false, isRefetching: true }),
    ).toEqual({ kind: 'pending' })
    expect(
      sessionReport({ data: null, error: null, isPending: false, isRefetching: true }),
    ).toEqual({ kind: 'pending' })
    expect(
      sessionReport({ data: { user }, error: null, isPending: false, isRefetching: false }),
    ).toEqual({ kind: 'signed-in', user: { id: 'u1', email: 'a@b.c', name: null, image: null } })
  })
})

describe('parseConfig', () => {
  it('keeps known providers in button order, once each', () => {
    expect(
      parseConfig({ providers: ['apple', 'twitter', 'google', 'apple'], appEnv: 'development' }),
    ).toEqual({ providers: ['google', 'apple'], appEnv: 'development' })
  })

  it('reads anything but development as production, and rejects other shapes', () => {
    expect(parseConfig({ providers: [], appEnv: 'staging' })).toEqual({
      providers: [],
      appEnv: 'production',
    })
    expect(parseConfig({ providers: 'google' })).toBeNull()
    expect(parseConfig(null)).toBeNull()
  })
})

describe('createAccountCache', () => {
  function memoryStorage() {
    const items = new Map<string, string>()
    return {
      items,
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => {
        items.set(key, value)
      },
      removeItem: (key: string) => {
        items.delete(key)
      },
    }
  }

  it('writes, reads and forgets the account under its key', () => {
    const storage = memoryStorage()
    const cache = createAccountCache(storage)
    cache?.write(ANN)
    expect(JSON.parse(storage.items.get(ACCOUNT_STORAGE_KEY) ?? '')).toEqual(ANN)
    expect(cache?.read()).toEqual(ANN)
    cache?.write(null)
    expect(storage.items.has(ACCOUNT_STORAGE_KEY)).toBe(false)
    expect(cache?.read()).toBeNull()
  })

  it('reads a malformed entry as no account and survives a storage that throws', () => {
    const storage = memoryStorage()
    storage.items.set(ACCOUNT_STORAGE_KEY, '{not json')
    expect(createAccountCache(storage)?.read()).toBeNull()
    storage.items.set(ACCOUNT_STORAGE_KEY, '{"id":42}')
    expect(createAccountCache(storage)?.read()).toBeNull()
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    const cache = createAccountCache(broken)
    expect(cache?.read()).toBeNull()
    expect(() => cache?.write(ANN)).not.toThrow()
    expect(() => cache?.write(null)).not.toThrow()
  })

  it('is null without storage', () => {
    expect(createAccountCache(null)).toBeNull()
    // Node has no localStorage.
    expect(createAccountCache()).toBeNull()
  })
})

describe('createBetterAuthBackend', () => {
  interface Recorded {
    readonly url: string
    readonly method: string
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

  /** Better Auth's client and the backend over a fake `fetch` answering with `respond`. */
  function setup(
    respond: (request: Recorded) => Response | Promise<Response>,
    tokenProvider?: () => string | null,
  ) {
    const requests: Recorded[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const request: Recorded = {
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        headers: new Headers(init?.headers),
        credentials: init?.credentials,
      }
      requests.push(request)
      return respond(request)
    }) as typeof fetch
    const client = createAppAuthClient({
      baseURL: 'http://localhost:5173',
      fetch: fetchImpl,
      ...(tokenProvider ? { tokenProvider } : {}),
    })
    const backend = createBetterAuthBackend(client, {
      fetch: fetchImpl,
      configUrl: 'http://localhost:5173/api/config',
    })
    return { client, backend, requests }
  }

  const userBody = {
    id: 'u1',
    email: 'ann@example.com',
    name: '',
    image: null,
    emailVerified: true,
    createdAt: '2026-10-18T00:00:00.000Z',
    updatedAt: '2026-10-18T00:00:00.000Z',
  }

  it('asks for a sign-in code', async () => {
    const { backend, requests } = setup(() => json({ success: true }))
    await expect(backend.sendCode('ann@example.com')).resolves.toEqual(OK)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:5173/api/auth/email-otp/send-verification-otp',
      method: 'POST',
      body: { email: 'ann@example.com', type: 'sign-in' },
      credentials: 'include',
    })
  })

  it('signs in with the code and returns the user', async () => {
    const { backend, requests } = setup(() => json({ token: 'session-token', user: userBody }))
    await expect(backend.verifyCode('ann@example.com', '123456')).resolves.toEqual({
      ok: true,
      value: {
        user: { id: 'u1', email: 'ann@example.com', name: null, image: null },
        token: 'session-token',
      },
    })
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:5173/api/auth/sign-in/email-otp',
      method: 'POST',
      body: { email: 'ann@example.com', otp: '123456' },
    })
  })

  it('turns failures into auth errors', async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => json({ code: 'INVALID_OTP', message: 'Invalid OTP' }, 400),
      () => json({ code: 'OTP_EXPIRED', message: 'OTP expired' }, 400),
      () => json({ code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' }, 403),
      () => json({ message: 'Too many requests. Please try again later.' }, 429),
      () => new Response('Bad Gateway', { status: 502 }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]
    let answer: (() => Response | Promise<Response>) | undefined
    const { backend } = setup(() => (answer ?? (() => json({})))())
    const errors: unknown[] = []
    for (const next of answers) {
      answer = next
      const result = await backend.verifyCode('ann@example.com', '000000')
      errors.push(result.ok ? 'ok' : result.error)
    }
    expect(errors).toEqual([
      'invalid-code',
      'expired-code',
      'too-many-attempts',
      'rate-limited',
      'network',
      'network',
    ])
  })

  it('starts a provider sign-in that returns to the page, on success and on failure', async () => {
    const { backend, requests } = setup(() =>
      json({ url: 'https://github.com/login/oauth/authorize?client_id=x', redirect: true }),
    )
    await expect(backend.signInSocial('github', 'http://localhost:5173/')).resolves.toEqual(OK)
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:5173/api/auth/sign-in/social',
      method: 'POST',
      body: {
        provider: 'github',
        callbackURL: 'http://localhost:5173/',
        errorCallbackURL: 'http://localhost:5173/',
      },
    })
  })

  it('signs out and deletes the account with POSTs', async () => {
    let deleteAnswer = json({ code: 'SESSION_EXPIRED', message: 'Session expired.' }, 400)
    const { backend, requests } = setup((request) =>
      request.url.endsWith('/delete-user') ? deleteAnswer : json({ success: true }),
    )
    await expect(backend.signOut()).resolves.toEqual(OK)
    await expect(backend.deleteUser()).resolves.toEqual({ ok: false, error: 'session-expired' })
    deleteAnswer = json({ success: true, message: 'User deleted' })
    await expect(backend.deleteUser()).resolves.toEqual(OK)
    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ['POST', 'http://localhost:5173/api/auth/sign-out'],
      ['POST', 'http://localhost:5173/api/auth/delete-user'],
      ['POST', 'http://localhost:5173/api/auth/delete-user'],
    ])
  })

  it('reports the session: pending, then what each check finds', async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => json({ session: { id: 's1', expiresAt: '2026-11-17T00:00:00.000Z' }, user: userBody }),
      () => Promise.reject(new TypeError('Failed to fetch')),
      () => json(null),
    ]
    let next = 0
    const { backend, requests } = setup(() => (answers[next++] ?? (() => json(null)))())
    const reports: SessionReport['kind'][] = []
    const stop = backend.watchSession((report) => reports.push(report.kind))
    expect(reports).toEqual(['pending'])
    await backend.refreshSession()
    expect(reports.at(-1)).toBe('signed-in')
    // Offline: the user stays as known.
    await backend.refreshSession()
    expect(reports.at(-1)).toBe('signed-in')
    await backend.refreshSession()
    expect(reports.at(-1)).toBe('signed-out')
    // The session cookie's cache would still vouch for a session deleted meanwhile.
    expect(requests[0]).toMatchObject({
      url: 'http://localhost:5173/api/auth/get-session?disableCookieCache=true',
      method: 'GET',
    })
    stop()
  })

  it('sends a bearer token when a token provider gives one', async () => {
    let token: string | null = 'desktop-token'
    const { backend, requests } = setup(
      () => json({ success: true }),
      () => token,
    )
    await backend.signOut()
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer desktop-token')
    token = null
    await backend.signOut()
    expect(requests[1]?.headers.get('authorization')).toBeNull()
  })

  it('reads the server configuration, or null when it cannot', async () => {
    const answers: (() => Response | Promise<Response>)[] = [
      () => json({ providers: ['github', 'google'], appEnv: 'development' }),
      () => json({ error: 'not-found' }, 404),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]
    let next = 0
    const { backend, requests } = setup(() => (answers[next++] ?? (() => json(null)))())
    await expect(backend.loadConfig()).resolves.toEqual({
      providers: ['google', 'github'],
      appEnv: 'development',
    })
    await expect(backend.loadConfig()).resolves.toBeNull()
    await expect(backend.loadConfig()).resolves.toBeNull()
    expect(requests[0]?.url).toBe('http://localhost:5173/api/config')
  })

  it('reaches the device approval endpoints the /device page uses', async () => {
    const { client, requests } = setup((request) =>
      request.method === 'GET'
        ? json({ user_code: 'ABCD-EFGH', status: 'pending' })
        : json({ success: true }),
    )
    const verified = await client.device({ query: { user_code: 'ABCD-EFGH' } })
    expect(verified.data?.status).toBe('pending')
    await client.device.approve({ userCode: 'ABCD-EFGH' })
    await client.device.deny({ userCode: 'ABCD-EFGH' })
    expect(requests.map((request) => [request.method, request.url, request.body])).toEqual([
      ['GET', 'http://localhost:5173/api/auth/device?user_code=ABCD-EFGH', undefined],
      ['POST', 'http://localhost:5173/api/auth/device/approve', { userCode: 'ABCD-EFGH' }],
      ['POST', 'http://localhost:5173/api/auth/device/deny', { userCode: 'ABCD-EFGH' }],
    ])
  })
})
