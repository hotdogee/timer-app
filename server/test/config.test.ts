import { env } from 'cloudflare:workers'
import { exportPKCS8, generateKeyPair } from 'jose'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAuth } from '../src/auth'
import { route } from '../src/index'
import type { ConfigResponse } from '../src/protocol'
import { request } from './helpers'

/** GET /api/config against the test env with `overrides` (a fresh env, so a fresh auth setup). */
async function configWith(overrides: Partial<Env> = {}): Promise<ConfigResponse> {
  const response = await route(request('/api/config'), { ...env, ...overrides })
  expect(response.status).toBe(200)
  return response.json()
}

/** A throwaway ES256 key in PEM form, as Apple's `.p8` file holds it. */
async function appleKey(): Promise<string> {
  const { privateKey } = await generateKeyPair('ES256', { extractable: true })
  return exportPKCS8(privateKey)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/config', () => {
  it('lists no providers when none is configured, and names the server mode', async () => {
    expect(await configWith()).toEqual({ providers: [], appEnv: 'development' })
  })

  it('is never cached and carries the API security headers', async () => {
    const response = await route(request('/api/config'), env)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin')
  })

  it('lists every provider whose id and secret are both set, in button order', async () => {
    const config = await configWith({
      GITHUB_CLIENT_ID: 'github-id',
      GITHUB_CLIENT_SECRET: 'github-secret',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    })
    expect(config.providers).toEqual(['google', 'github'])
  })

  it('leaves out a provider with half its credentials, and says why', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const config = await configWith({ GOOGLE_CLIENT_ID: 'google-id', GITHUB_CLIENT_SECRET: 'x' })
    expect(config.providers).toEqual([])
    const messages = warn.mock.calls.map((args) => String(args[0]))
    expect(messages.some((message) => message.includes('GOOGLE_CLIENT_SECRET'))).toBe(true)
    expect(messages.some((message) => message.includes('GITHUB_CLIENT_ID'))).toBe(true)
  })

  it('treats blank values as not configured', async () => {
    const config = await configWith({ GOOGLE_CLIENT_ID: '   ', GOOGLE_CLIENT_SECRET: 'secret' })
    expect(config.providers).toEqual([])
  })

  it('offers Apple when its key signs a client secret', async () => {
    const config = await configWith({
      APPLE_CLIENT_ID: 'com.example.timer.web',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: (await appleKey()).replace(/\n/g, '\\n'),
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    })
    expect(config.providers).toEqual(['google', 'apple'])
  })

  it('hides Apple when the key is unusable, without logging the key', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const config = await configWith({
      APPLE_CLIENT_ID: 'com.example.timer.web',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: 'not-a-key-but-secret-material',
    })
    expect(config.providers).toEqual([])
    expect(error).toHaveBeenCalled()
    const logged = error.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('APPLE_PRIVATE_KEY')
    expect(logged).not.toContain('secret-material')
  })

  it('reports production for any mode but development', async () => {
    expect((await configWith({ APP_ENV: 'production' })).appEnv).toBe('production')
    expect((await configWith({ APP_ENV: 'staging' })).appEnv).toBe('production')
    expect((await configWith({ APP_ENV: 'Development' })).appEnv).toBe('production')
  })

  it('only answers GET', async () => {
    const response = await route(request('/api/config', { method: 'POST' }), env)
    expect(response.status).toBe(405)
  })
})

describe('required settings', () => {
  it('refuses to run auth without a strong secret or a usable public URL', async () => {
    for (const overrides of [
      { BETTER_AUTH_SECRET: '' },
      { BETTER_AUTH_SECRET: 'too-short-secret' },
      { BETTER_AUTH_SECRET: undefined as unknown as string },
      { BETTER_AUTH_URL: 'not a url' },
    ]) {
      const broken = { ...env, ...overrides }
      await expect(route(request('/api/auth/get-session'), broken)).rejects.toThrow(
        /BETTER_AUTH_(SECRET|URL)/,
      )
    }
  })

  it('names the setting but never echoes its value', async () => {
    const weak = 'short-but-secret-value'
    const failure = route(request('/api/config'), { ...env, BETTER_AUTH_SECRET: weak })
    await expect(failure).rejects.toThrow('BETTER_AUTH_SECRET')
    await expect(failure).rejects.not.toThrow(weak)
  })
})

describe('the auth instance', () => {
  it('is built once per environment object (once per isolate), Apple secret included', async () => {
    const withApple = {
      ...env,
      APPLE_CLIENT_ID: 'com.example.timer.web',
      APPLE_TEAM_ID: 'TEAM123456',
      APPLE_KEY_ID: 'KEY1234567',
      APPLE_PRIVATE_KEY: (await appleKey()).replace(/\n/g, '\\n'),
    }
    expect(createAuth(withApple)).toBe(createAuth(withApple))
    const first = await createAuth(withApple)
    expect((await route(request('/api/config'), withApple)).status).toBe(200)
    expect((await route(request('/api/auth/get-session'), withApple)).status).toBe(200)
    const later = await createAuth(withApple)
    expect(later).toBe(first)
    expect(later.auth).toBe(first.auth)
    expect(later.providers).toBe(first.providers)
    expect(first.providers).toEqual(['apple'])
    // Another environment object gets its own.
    expect(createAuth({ ...withApple })).not.toBe(createAuth(withApple))
  })

  it('is built again after a build that failed', async () => {
    const changing = { ...env, BETTER_AUTH_SECRET: 'too-short' }
    await expect(createAuth(changing)).rejects.toThrow('BETTER_AUTH_SECRET')
    changing.BETTER_AUTH_SECRET = env.BETTER_AUTH_SECRET
    const context = await createAuth(changing)
    expect(context.providers).toEqual([])
    expect(createAuth(changing)).toBe(createAuth(changing))
  })
})
