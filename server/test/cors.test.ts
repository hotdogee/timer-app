import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import {
  CORS_ALLOW_HEADERS,
  CORS_ALLOW_METHODS,
  DESKTOP_ORIGINS,
  allowedOrigin,
  corsOrigins,
  isPreflight,
} from '../src/cors'
import { route } from '../src/index'
import { API_PATHS, DESKTOP_CLIENT_ID, type DevOtpResponse } from '../src/protocol'
import { call, freshEmail, freshIp, request, signIn } from './helpers'

/** The desktop app on Windows. */
const DESKTOP = 'http://tauri.localhost'
const FOREIGN = 'https://evil.example'

/** What a webview adds to a cross-origin `fetch` (WebView2 is Chromium). */
const CROSS_SITE_FETCH = {
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Dest': 'empty',
}

/** A preflight for a JSON POST with a bearer token, as a webview sends it. */
function preflightFrom(origin: string, path: string = API_PATHS.time): Request {
  return request(path, {
    method: 'OPTIONS',
    origin,
    headers: {
      ...CROSS_SITE_FETCH,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization, content-type',
    },
  })
}

/** The response's `Access-Control-*` headers. */
function corsHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    [...response.headers].filter(([name]) => name.toLowerCase().startsWith('access-control-')),
  )
}

function varies(response: Response): boolean {
  const vary = response.headers.get('Vary') ?? ''
  return vary.split(',').some((name) => name.trim().toLowerCase() === 'origin')
}

describe('CORS preflights', () => {
  it('answers a desktop origin’s preflight with 204 and the CORS headers, without credentials', async () => {
    for (const origin of DESKTOP_ORIGINS) {
      const response = await route(preflightFrom(origin), env)
      expect(response.status).toBe(204)
      expect(corsHeaders(response)).toEqual({
        'access-control-allow-origin': origin,
        'access-control-allow-headers': CORS_ALLOW_HEADERS,
        'access-control-allow-methods': CORS_ALLOW_METHODS,
        'access-control-max-age': '600',
      })
      expect(varies(response)).toBe(true)
      expect(await response.text()).toBe('')
    }
  })

  it('answers any API path’s preflight, Better Auth’s included, before it is routed', async () => {
    for (const path of ['/api/auth/device/token', '/api/auth/sign-in/email-otp', '/api/nope']) {
      const response = await route(preflightFrom(DESKTOP, path), env)
      expect(response.status).toBe(204)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
    }
  })

  it('gives a foreign origin’s preflight no CORS headers, so the browser refuses the request', async () => {
    for (const origin of [
      FOREIGN,
      'http://tauri.localhost:8080',
      'http://tauri.localhost.evil.example',
      'tauri://localhost.evil.example',
      'null',
    ]) {
      const response = await route(preflightFrom(origin), env)
      expect(response.status).toBe(204)
      expect(corsHeaders(response), origin).toEqual({})
      expect(varies(response)).toBe(true)
    }
  })

  it('leaves OPTIONS outside the API and without CORS request headers to the routes', async () => {
    const asks = { 'Access-Control-Request-Method': 'POST' }
    expect(isPreflight(request('/api/time', { method: 'OPTIONS', headers: asks }))).toBe(true)
    expect(isPreflight(request('/api/time', { method: 'OPTIONS' }))).toBe(false)
    expect(
      isPreflight(request('/api/time', { method: 'OPTIONS', origin: null, headers: asks })),
    ).toBe(false)
    expect(isPreflight(request('/api/time', { method: 'POST', headers: asks }))).toBe(false)
    const plain = await call(API_PATHS.time, { method: 'OPTIONS', origin: DESKTOP })
    expect(plain.status).toBe(405)
    expect(plain.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
  })
})

describe('CORS on API responses', () => {
  it('names a desktop origin on every API response to it', async () => {
    const time = await call(API_PATHS.time, { origin: DESKTOP })
    expect(time.status).toBe(200)
    expect(time.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
    expect(time.headers.get('Access-Control-Allow-Credentials')).toBeNull()
    expect(varies(time)).toBe(true)
    // The API's own headers stay.
    expect(time.headers.get('Cache-Control')).toBe('no-store')
    expect(time.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const missing = await call('/api/nope', { origin: 'tauri://localhost' })
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Access-Control-Allow-Origin')).toBe('tauri://localhost')

    const session = await call('/api/auth/get-session', { origin: DESKTOP })
    expect(session.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
  })

  it('gives foreign origins and same-origin requests without Origin no CORS headers', async () => {
    for (const origin of [FOREIGN, null]) {
      const response = await call(API_PATHS.time, { origin })
      expect(response.status).toBe(200)
      expect(corsHeaders(response)).toEqual({})
      expect(varies(response)).toBe(true)
    }
  })

  it('also allows the origins the server already trusts (the tauri dev page among them)', async () => {
    const devEnv = { ...env, TRUSTED_ORIGINS: 'http://localhost:5173, not a url' }
    expect(corsOrigins(devEnv)).toEqual([
      ...DESKTOP_ORIGINS,
      'http://localhost:8787',
      'http://localhost:5173',
    ])
    const response = await route(
      request(API_PATHS.time, { origin: 'http://localhost:5173' }),
      devEnv,
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
    expect(
      allowedOrigin(request(API_PATHS.time, { origin: 'http://localhost:4173' }), devEnv),
    ).toBe(null)
  })

  it('adds nothing outside the API', () => {
    const assets = {
      fetch: () => Promise.resolve(new Response('app')),
    } as unknown as Fetcher
    return route(request('/', { origin: DESKTOP }), { ...env, ASSETS: assets }).then((response) => {
      expect(corsHeaders(response)).toEqual({})
    })
  })
})

interface DeviceCodeBody {
  readonly device_code: string
  readonly user_code: string
}

describe('desktop sign-in across origins', () => {
  it('signs in through the device flow and uses the bearer token from the desktop origin', async () => {
    const ip = freshIp()
    const fromDesktop = { origin: DESKTOP, ip, headers: CROSS_SITE_FETCH }

    const started = await call('/api/auth/device/code', {
      ...fromDesktop,
      body: { client_id: DESKTOP_CLIENT_ID },
    })
    expect(started.status).toBe(200)
    expect(started.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
    const code: DeviceCodeBody = await started.json()

    // The user approves on the /device page, signed in on the web app's own origin.
    const user = await signIn()
    const claim = await call(`/api/auth/device?user_code=${code.user_code}`, {
      headers: { Cookie: user.cookie },
    })
    expect(claim.status).toBe(200)
    const approve = await call('/api/auth/device/approve', {
      body: { userCode: code.user_code },
      headers: { Cookie: user.cookie },
    })
    expect(approve.status).toBe(200)

    const token = await call('/api/auth/device/token', {
      ...fromDesktop,
      body: {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.device_code,
        client_id: DESKTOP_CLIENT_ID,
      },
    })
    expect(token.status).toBe(200)
    expect(token.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
    const { access_token: accessToken } = await token.json<{ access_token: string }>()

    const session = await call('/api/auth/get-session', {
      ...fromDesktop,
      headers: { ...CROSS_SITE_FETCH, Authorization: `Bearer ${accessToken}` },
    })
    expect(session.status).toBe(200)
    expect(session.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
    const body = await session.json<{ user: { id: string } } | null>()
    expect(body?.user.id).toBe(user.userId)

    const exported = await call(API_PATHS.export, {
      ...fromDesktop,
      headers: { ...CROSS_SITE_FETCH, Authorization: `Bearer ${accessToken}` },
    })
    expect(exported.status).toBe(200)
    expect(exported.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
  })

  it('signs in with an emailed code from the desktop origin, the token readable across origins', async () => {
    const email = freshEmail('desktop')
    const ip = freshIp()
    const fromDesktop = { origin: DESKTOP, ip, headers: CROSS_SITE_FETCH }
    const sent = await call(`${API_PATHS.auth}/email-otp/send-verification-otp`, {
      ...fromDesktop,
      body: { email, type: 'sign-in' },
    })
    expect(sent.status).toBe(200)
    const dev = await call(`${API_PATHS.devOtp}?email=${encodeURIComponent(email)}`)
    const { otp } = await dev.json<DevOtpResponse>()

    const signedIn = await call(`${API_PATHS.auth}/sign-in/email-otp`, {
      ...fromDesktop,
      body: { email, otp },
    })
    expect(signedIn.status).toBe(200)
    expect(signedIn.headers.get('Access-Control-Allow-Origin')).toBe(DESKTOP)
    // Better Auth's bearer plugin exposes the token header; the CORS layer keeps that.
    expect(signedIn.headers.get('Access-Control-Expose-Headers')).toContain('set-auth-token')
    expect(signedIn.headers.get('set-auth-token')).toBeTruthy()
  })

  it('refuses the same sign-in from a foreign origin', async () => {
    const email = freshEmail('foreign')
    const response = await call(`${API_PATHS.auth}/email-otp/send-verification-otp`, {
      origin: FOREIGN,
      headers: CROSS_SITE_FETCH,
      body: { email, type: 'sign-in' },
    })
    expect(response.status).toBe(403)
    expect(corsHeaders(response)).toEqual({})
  })
})
