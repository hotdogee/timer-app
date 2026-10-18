import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { route } from '../src/index'
import {
  DEFAULT_DAILY_CODE_EMAILS,
  SEND_LIMIT_ERROR_CODES,
  addressKey,
  consume,
  dailyLimit,
  dayKey,
} from '../src/send-limit'
import { freshEmail, request } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('consume', () => {
  it('counts uses in a fixed window and refuses past the limit until it ends', async () => {
    const key = `test:${crypto.randomUUID()}`
    const start = 1_000_000_000_000
    expect(await consume(env.DB, key, 60, 2, start)).toEqual({ allowed: true, retryAfter: 0 })
    expect((await consume(env.DB, key, 60, 2, start + 1_000)).allowed).toBe(true)
    expect(await consume(env.DB, key, 60, 2, start + 20_000)).toEqual({
      allowed: false,
      retryAfter: 40,
    })
    // Refused uses do not stretch the window.
    expect((await consume(env.DB, key, 60, 2, start + 59_000)).allowed).toBe(false)
    expect((await consume(env.DB, key, 60, 2, start + 60_000)).allowed).toBe(true)
  })

  it('keeps addresses hashed, never in the clear', async () => {
    const email = freshEmail()
    const key = await addressKey(` ${email.toUpperCase()} `)
    expect(key).toBe(await addressKey(email))
    expect(key).toMatch(/^email:[0-9a-f]{64}$/)
    expect(key).not.toContain(email.split('@')[0])
  })

  it('prunes counters older than two days', async () => {
    const old = `test:${crypto.randomUUID()}`
    const now = Date.now()
    await consume(env.DB, old, 60, 5, now - 3 * 86_400_000)
    await consume(env.DB, `test:${crypto.randomUUID()}`, 60, 5, now)
    const row = await env.DB.prepare('SELECT "key" FROM "sendLimit" WHERE "key" = ?')
      .bind(old)
      .first()
    expect(row).toBeNull()
  })
})

describe('the daily limit on code emails', () => {
  it('defaults to the Resend free plan and reads EMAIL_DAILY_LIMIT', () => {
    expect(dailyLimit(env)).toBe(DEFAULT_DAILY_CODE_EMAILS)
    expect(dailyLimit({ ...env, EMAIL_DAILY_LIMIT: '250' })).toBe(250)
    for (const value of ['0', '-3', '2.5', 'many', ' ']) {
      expect(dailyLimit({ ...env, EMAIL_DAILY_LIMIT: value })).toBe(DEFAULT_DAILY_CODE_EMAILS)
    }
    expect(dayKey(Date.UTC(2026, 9, 18, 23, 59))).toBe('day:2026-10-18')
  })

  it('stops mailing codes for the day once the limit is reached', async () => {
    const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'x' }))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const withResend = { ...env, RESEND_API_KEY: 're_test_placeholder', EMAIL_DAILY_LIMIT: '2' }
    const ask = (email: string): Promise<Response> =>
      route(
        request('/api/auth/email-otp/send-verification-otp', {
          body: { email, type: 'sign-in' },
        }),
        withResend,
      )
    expect((await ask(freshEmail())).status).toBe(200)
    expect((await ask(freshEmail())).status).toBe(200)
    const refused = await ask(freshEmail())
    expect(refused.status).toBe(503)
    const body: { code?: string } = await refused.json()
    expect(body.code).toBe(SEND_LIMIT_ERROR_CODES.unavailable)
    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2)
    })
  })

  it('does not apply to the console mailer in development', async () => {
    const ask = (email: string): Promise<Response> =>
      route(
        request('/api/auth/email-otp/send-verification-otp', {
          body: { email, type: 'sign-in' },
        }),
        { ...env, EMAIL_DAILY_LIMIT: '1' },
      )
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    for (let i = 0; i < 3; i++) expect((await ask(freshEmail())).status).toBe(200)
  })
})
