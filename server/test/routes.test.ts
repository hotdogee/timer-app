import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { route } from '../src/index'
import type { ApiErrorResponse } from '../src/protocol'
import { call, devCode, freshEmail, request, requestCode } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

/** An ASSETS binding that answers every request with `asset:<path>`. */
function fakeAssets() {
  const fetch = vi.fn((input: Request) =>
    Promise.resolve(new Response(`asset:${new URL(input.url).pathname}`)),
  )
  return { fetch, binding: { fetch } as unknown as Fetcher }
}

describe('routing', () => {
  it('hands paths outside the API to the static assets', async () => {
    const assets = fakeAssets()
    for (const path of ['/', '/device', '/assets/index.js', '/apis']) {
      const response = await route(request(path), { ...env, ASSETS: assets.binding })
      expect(await response.text()).toBe(`asset:${path}`)
    }
    expect(assets.fetch).toHaveBeenCalledTimes(4)
  })

  it('answers unknown API paths with a JSON 404 instead of the app', async () => {
    const assets = fakeAssets()
    for (const path of ['/api', '/api/nope', '/api/sync/extra', '/__dev', '/__dev/nope']) {
      const response = await route(request(path), { ...env, ASSETS: assets.binding })
      expect(response.status).toBe(404)
      const body: ApiErrorResponse = await response.json()
      expect(body).toEqual({ error: 'not-found' })
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    }
    expect(assets.fetch).not.toHaveBeenCalled()
  })

  it('adds the API security headers to auth responses', async () => {
    const response = await call('/api/auth/get-session')
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin')
  })
})

describe('GET /__dev/otp', () => {
  it('returns the last code mailed to an address in development, case-insensitively', async () => {
    const email = freshEmail()
    expect((await requestCode(email)).status).toBe(200)
    const first = await devCode(email)
    expect(first).toMatch(/^\d{6}$/)
    expect(await devCode(email.toUpperCase())).toBe(first)
  })

  it('needs an email, and knows only addresses a code was sent to', async () => {
    const missing = await call('/__dev/otp')
    expect(missing.status).toBe(400)
    const unknown = await call(`/__dev/otp?email=${encodeURIComponent(freshEmail())}`)
    expect(unknown.status).toBe(404)
  })

  it('does not exist outside development, for any method', async () => {
    const production = { ...env, APP_ENV: 'production' }
    const email = freshEmail()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    // A code requested from a production server (here without a mailer, so it is refused) is
    // never kept for the endpoint.
    const sent = await route(
      request('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } }),
      production,
    )
    expect(sent.status).toBe(503)
    // Nor with a mailer.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'email-id' }))
    const mailed = await route(
      request('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } }),
      { ...production, RESEND_API_KEY: 're_test_placeholder' },
    )
    expect(mailed.status).toBe(200)
    for (const method of ['GET', 'POST']) {
      const response = await route(
        request(`/__dev/otp?email=${encodeURIComponent(email)}`, { method }),
        production,
      )
      expect(response.status).toBe(404)
      const body: ApiErrorResponse = await response.json()
      expect(body).toEqual({ error: 'not-found' })
    }
    expect((await call(`/__dev/otp?email=${encodeURIComponent(email)}`)).status).toBe(404)
  })

  it('is off for any mode other than exactly development', async () => {
    const email = freshEmail()
    expect((await requestCode(email)).status).toBe(200)
    const path = `/__dev/otp?email=${encodeURIComponent(email)}`
    for (const mode of ['production', 'staging', 'Development', '']) {
      const response = await route(request(path), { ...env, APP_ENV: mode })
      expect(response.status).toBe(404)
    }
    expect((await route(request(path), env)).status).toBe(200)
  })
})
