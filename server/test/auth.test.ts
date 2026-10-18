import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { OTP_ALLOWED_ATTEMPTS } from '../src/auth-options'
import { route } from '../src/index'
import { CODE_EMAIL_SUBJECT, RESEND_ENDPOINT } from '../src/mail'
import type { ApiErrorResponse } from '../src/protocol'
import { CODE_EMAILS_PER_ADDRESS, SEND_LIMIT_ERROR_CODES } from '../src/send-limit'
import {
  call,
  cookiesOf,
  devCode,
  expectRefused,
  freshEmail,
  freshIp,
  openSync,
  request,
  requestCode,
  signIn,
  submitCode,
} from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

interface SessionBody {
  readonly user: { readonly id: string; readonly email: string; readonly emailVerified: boolean }
  readonly session: { readonly userId: string; readonly expiresAt: string }
}

interface ErrorBody {
  readonly code?: string
}

function getSession(headers: HeadersInit): Promise<Response> {
  return call('/api/auth/get-session', { headers })
}

describe('sign-in with an emailed code', () => {
  it('works end to end: code sent, code read back, session cookie and token issued', async () => {
    const email = freshEmail()
    const ip = freshIp()
    const sent = await requestCode(email, ip)
    expect(sent.status).toBe(200)
    expect(await sent.json()).toEqual({ success: true })

    const otp = await devCode(email)
    expect(otp).toMatch(/^\d{6}$/)

    const signedIn = await submitCode(email, otp, ip)
    expect(signedIn.status).toBe(200)
    const body: { user: { id: string; email: string; emailVerified: boolean } } =
      await signedIn.json()
    expect(body.user.email).toBe(email)
    expect(body.user.emailVerified).toBe(true)
    expect(body.user.id).toMatch(/^[0-9a-f-]{36}$/)

    const sessionCookie = signedIn.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('timer.session_token='))
    expect(sessionCookie).toBeDefined()
    expect(sessionCookie).toMatch(/HttpOnly/i)
    expect(sessionCookie).toMatch(/SameSite=Lax/i)
    expect(sessionCookie).toMatch(/Path=\//)
    expect(signedIn.headers.get('set-auth-token')).toBeTruthy()

    const session = await getSession({ Cookie: cookiesOf(signedIn) })
    expect(session.status).toBe(200)
    const current: SessionBody = await session.json()
    expect(current.user.id).toBe(body.user.id)
    expect(current.session.userId).toBe(body.user.id)
    // 30-day sessions.
    const days = (Date.parse(current.session.expiresAt) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29)
    expect(days).toBeLessThanOrEqual(30)
  })

  it('signs the same address in to the same account, whatever its case', async () => {
    const email = freshEmail()
    const first = await signIn(email)
    const second = await signIn(email.toUpperCase())
    expect(second.userId).toBe(first.userId)
  })

  it('keeps the code encrypted in D1, never in the clear', async () => {
    const email = freshEmail()
    await requestCode(email)
    const otp = await devCode(email)
    const row = await env.DB.prepare('SELECT "value" FROM "verification" WHERE "identifier" = ?')
      .bind(`sign-in-otp-${email}`)
      .first<{ value: string }>()
    expect(row).not.toBeNull()
    expect(row?.value).not.toContain(otp)
  })

  it('rejects wrong codes and locks the code after five wrong attempts', async () => {
    const email = freshEmail()
    const ip = freshIp()
    await requestCode(email, ip)
    const otp = await devCode(email)
    const wrong = otp === '000000' ? '111111' : '000000'

    for (let attempt = 0; attempt < OTP_ALLOWED_ATTEMPTS; attempt++) {
      const response = await submitCode(email, wrong, ip)
      expect(response.status).toBe(400)
      const body: ErrorBody = await response.json()
      expect(body.code).toBe('INVALID_OTP')
    }
    const locked = await submitCode(email, otp, ip)
    expect(locked.status).toBe(403)
    const body: ErrorBody = await locked.json()
    expect(body.code).toBe('TOO_MANY_ATTEMPTS')
    expect(locked.headers.getSetCookie()).toEqual([])
    // The code is gone; a new one works.
    expect((await submitCode(email, otp, ip)).status).toBe(400)
    await requestCode(email, ip)
    expect((await submitCode(email, await devCode(email), ip)).status).toBe(200)
  })

  it('limits code requests to three a minute per client IP', async () => {
    const ip = freshIp()
    for (let i = 0; i < 3; i++) {
      expect((await requestCode(freshEmail(), ip)).status).toBe(200)
    }
    const limited = await requestCode(freshEmail(), ip)
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('X-Retry-After'))).toBeGreaterThan(0)
    // Other clients are not affected.
    expect((await requestCode(freshEmail(), freshIp())).status).toBe(200)
  })

  it('limits codes per address to five an hour, whichever client asks', async () => {
    const email = freshEmail()
    for (let i = 0; i < CODE_EMAILS_PER_ADDRESS.max; i++) {
      expect((await requestCode(email, freshIp())).status).toBe(200)
    }
    const limited = await requestCode(email, freshIp())
    expect(limited.status).toBe(429)
    const body: ErrorBody = await limited.json()
    expect(body.code).toBe(SEND_LIMIT_ERROR_CODES.tooManyEmails)
    const retryAfter = Number(limited.headers.get('X-Retry-After'))
    expect(retryAfter).toBeGreaterThan(CODE_EMAILS_PER_ADDRESS.windowSeconds - 60)
    expect(retryAfter).toBeLessThanOrEqual(CODE_EMAILS_PER_ADDRESS.windowSeconds)
    // Other addresses are not affected.
    expect((await requestCode(freshEmail(), freshIp())).status).toBe(200)
  })

  it('mails the pending code again on a resend, so a resend never kills it', async () => {
    const email = freshEmail()
    await requestCode(email, freshIp())
    const otp = await devCode(email)
    // Someone else asks for a code for this address: the same code goes out again.
    expect((await requestCode(email, freshIp())).status).toBe(200)
    expect(await devCode(email)).toBe(otp)
    expect((await submitCode(email, otp)).status).toBe(200)
  })

  it('keeps counting wrong attempts across resends', async () => {
    const email = freshEmail()
    await requestCode(email, freshIp())
    const otp = await devCode(email)
    const wrong = otp === '000000' ? '111111' : '000000'
    for (let attempt = 0; attempt < OTP_ALLOWED_ATTEMPTS - 1; attempt++) {
      expect((await submitCode(email, wrong)).status).toBe(400)
    }
    await requestCode(email, freshIp())
    expect(await devCode(email)).toBe(otp)
    expect((await submitCode(email, wrong)).status).toBe(400)
    const locked = await submitCode(email, otp)
    expect(locked.status).toBe(403)
    const body: ErrorBody = await locked.json()
    expect(body.code).toBe('TOO_MANY_ATTEMPTS')
  })

  it('refuses code requests at once on a production server without a mailer', async () => {
    const warnings = [
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
    ]
    const email = freshEmail()
    const response = await route(
      request('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } }),
      { ...env, APP_ENV: 'production' },
    )
    expect(response.status).toBe(503)
    const body: ErrorBody = await response.json()
    expect(body.code).toBe(SEND_LIMIT_ERROR_CODES.unavailable)
    // No code was made, and nothing about the address reached the logs.
    const row = await env.DB.prepare('SELECT "id" FROM "verification" WHERE "identifier" = ?')
      .bind(`sign-in-otp-${email}`)
      .first()
    expect(row).toBeNull()
    const logged = warnings.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ')
    expect(logged).not.toContain(email)
  })

  it('limits code submissions to ten a minute per client IP', async () => {
    const ip = freshIp()
    const email = freshEmail()
    await requestCode(email, freshIp())
    for (let i = 0; i < 10; i++) {
      expect((await submitCode(email, '000000', ip)).status).not.toBe(429)
    }
    expect((await submitCode(email, '000000', ip)).status).toBe(429)
  })

  it('refuses a code request from an untrusted origin', async () => {
    const response = await call('/api/auth/email-otp/send-verification-otp', {
      body: { email: freshEmail(), type: 'sign-in' },
      origin: 'https://evil.example',
    })
    expect(response.status).toBe(403)
  })

  it('mails no code for the code types the app does not use', async () => {
    const email = freshEmail()
    await signIn(email)
    const before = await devCode(email)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const response = await call('/api/auth/email-otp/send-verification-otp', {
      body: { email, type: 'email-verification' },
    })
    expect(response.status).toBe(200)
    // The mailer never ran: no log line, and the code on record is still the sign-in one.
    expect(warn.mock.calls.flat().map(String).join(' ')).not.toContain(email)
    expect(await devCode(email)).toBe(before)
  })

  it('has no password or email-change endpoints', async () => {
    for (const path of [
      '/api/auth/email-otp/request-password-reset',
      '/api/auth/forget-password/email-otp',
      '/api/auth/email-otp/reset-password',
      '/api/auth/email-otp/request-email-change',
      '/api/auth/email-otp/change-email',
    ]) {
      const response = await call(path, { body: { email: freshEmail() } })
      expect(response.status).toBe(404)
    }
    const signUp = await call('/api/auth/sign-up/email', {
      body: { email: freshEmail(), password: 'password1234', name: 'x' },
    })
    expect(signUp.status).toBeGreaterThanOrEqual(400)
  })
})

describe('sessions', () => {
  it('accept a bearer token instead of the cookie', async () => {
    const user = await signIn()
    const response = await getSession({ Authorization: `Bearer ${user.token}` })
    const body: SessionBody | null = await response.json()
    expect(body?.user.id).toBe(user.userId)
    const forged = await getSession({ Authorization: `Bearer ${user.token}x` })
    expect(await forged.json()).toBeNull()
  })

  it('refuse a cookie-carrying POST from an untrusted origin (CSRF)', async () => {
    const user = await signIn()
    const forged = await call('/api/auth/sign-out', {
      body: {},
      headers: { Cookie: user.cookie },
      origin: 'https://evil.example',
    })
    expect(forged.status).toBe(403)
    const still: SessionBody | null = await (await getSession({ Cookie: user.cookie })).json()
    expect(still?.user.id).toBe(user.userId)
  })

  it('end at once for our endpoints on sign-out, despite the cached session cookie', async () => {
    const user = await signIn()
    expect((await call('/api/export', { headers: { Cookie: user.cookie } })).status).toBe(200)
    const out = await call('/api/auth/sign-out', { body: {}, headers: { Cookie: user.cookie } })
    expect(out.status).toBe(200)

    // The old cookies still include the 5-minute session cache; our endpoints ignore it.
    const exported = await call('/api/export', { headers: { Cookie: user.cookie } })
    expect(exported.status).toBe(401)
    const body: ApiErrorResponse = await exported.json()
    expect(body).toEqual({ error: 'unauthorized' })
    await expectRefused(await openSync({ cookie: user.cookie }))
    expect(
      (await call('/api/export', { headers: { Authorization: `Bearer ${user.token}` } })).status,
    ).toBe(401)
  })
})

describe('provider sign-in', () => {
  it('sends a callback it cannot match to a sign-in back to the app, not to an error page', async () => {
    const withGoogle = {
      ...env,
      GOOGLE_CLIENT_ID: 'google-placeholder-id',
      GOOGLE_CLIENT_SECRET: 'google-placeholder-secret',
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const query of ['?error=access_denied&state=bogus', '?code=x&state=bogus']) {
      const response = await route(request(`/api/auth/callback/google${query}`), withGoogle)
      expect(response.status).toBe(302)
      const location = new URL(response.headers.get('Location') ?? '', env.BETTER_AUTH_URL)
      expect(location.origin + location.pathname).toBe(`${env.BETTER_AUTH_URL}/`)
      expect(location.searchParams.get('error')).toBe('state_mismatch')
    }
  })
})

describe('the mailer', () => {
  it('sends the code through Resend when RESEND_API_KEY is set, and keeps no copy', async () => {
    const send = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ id: 'email-id' }, { status: 200 }))
    const withResend = {
      ...env,
      RESEND_API_KEY: 're_test_placeholder',
      EMAIL_FROM: 'Timer App <no-reply@example.com>',
    }
    const email = freshEmail()
    const response = await route(
      request('/api/auth/email-otp/send-verification-otp', { body: { email, type: 'sign-in' } }),
      withResend,
    )
    expect(response.status).toBe(200)

    await vi.waitFor(() => {
      expect(send).toHaveBeenCalledOnce()
    })
    const [url, init] = send.mock.calls[0] ?? []
    expect(url).toBe(RESEND_ENDPOINT)
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer re_test_placeholder')
    const payload = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      to: string[]
      subject: string
      text: string
    }
    expect(payload.to).toEqual([email])
    expect(payload.subject).toBe(CODE_EMAIL_SUBJECT)
    expect(payload.text).toMatch(/Your Timer App code: \d{6}\. It expires in 10 minutes\./)

    send.mockRestore()
    expect((await call(`/__dev/otp?email=${encodeURIComponent(email)}`)).status).toBe(404)
  })
})
