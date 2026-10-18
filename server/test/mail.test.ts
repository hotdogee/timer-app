import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CODE_EMAIL_SUBJECT,
  FALLBACK_FROM,
  RESEND_ENDPOINT,
  codeEmail,
  createMailer,
  lastDevCode,
} from '../src/mail'
import { freshEmail } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

const resendEnv = {
  ...env,
  RESEND_API_KEY: 're_test_placeholder',
  EMAIL_FROM: 'Timer App <no-reply@example.com>',
}

interface ResendPayload {
  readonly from: string
  readonly to: string[]
  readonly subject: string
  readonly text: string
  readonly html: string
}

function payloadOf(send: { mock: { calls: unknown[][] } }): ResendPayload {
  const init = send.mock.calls[0]?.[1] as RequestInit | undefined
  return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as ResendPayload
}

describe('createMailer without RESEND_API_KEY', () => {
  it('logs the code and keeps it for /__dev/otp in development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const email = freshEmail()
    await createMailer(env).sendCode(email, '123456')
    expect(lastDevCode(email)).toBe('123456')
    expect(lastDevCode(` ${email.toUpperCase()} `)).toBe('123456')
    expect(String(warn.mock.calls[0]?.[0])).toContain('123456')
  })

  it('never logs the code or the address in production, and fails instead', async () => {
    const spies = [
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
    ]
    const email = freshEmail()
    await expect(
      createMailer({ ...env, APP_ENV: 'production' }).sendCode(email, '654321'),
    ).rejects.toThrow('RESEND_API_KEY')
    expect(lastDevCode(email)).toBeUndefined()
    const logged = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ')
    expect(logged).toContain('RESEND_API_KEY')
    expect(logged).not.toContain('654321')
    expect(logged).not.toContain(email)
  })
})

describe('createMailer with RESEND_API_KEY', () => {
  it('posts the code email to Resend', async () => {
    const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'x' }))
    const email = freshEmail()
    await createMailer(resendEnv).sendCode(email, '246810')

    expect(send).toHaveBeenCalledOnce()
    const [url, init] = send.mock.calls[0] ?? []
    expect(url).toBe(RESEND_ENDPOINT)
    expect(init?.method).toBe('POST')
    const headers = new Headers(init?.headers)
    expect(headers.get('Authorization')).toBe('Bearer re_test_placeholder')
    expect(headers.get('Content-Type')).toBe('application/json')
    const payload = payloadOf(send)
    expect(payload).toEqual({
      from: 'Timer App <no-reply@example.com>',
      to: [email],
      subject: CODE_EMAIL_SUBJECT,
      ...codeEmail('246810'),
    })
    expect(payload.text).toContain('Your Timer App code: 246810. It expires in 10 minutes.')
    expect(payload.html).toContain('246810')
    // A real mailer keeps nothing for the development endpoint.
    expect(lastDevCode(email)).toBeUndefined()
  })

  it("sends from Resend's test address when EMAIL_FROM is not set", async () => {
    const send = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: 'x' }))
    await createMailer({ ...resendEnv, EMAIL_FROM: ' ' }).sendCode(freshEmail(), '111111')
    expect(payloadOf(send).from).toBe(FALLBACK_FROM)
  })

  it('logs a refusal without the API key and without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ message: 'domain not verified' }, { status: 403 }),
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(createMailer(resendEnv).sendCode(freshEmail(), '222222')).resolves.toBeUndefined()
    const logged = error.mock.calls.flat().map(String).join(' ')
    expect(logged).toContain('403')
    expect(logged).toContain('domain not verified')
    expect(logged).not.toContain('re_test_placeholder')
  })

  it('logs a network failure without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(createMailer(resendEnv).sendCode(freshEmail(), '333333')).resolves.toBeUndefined()
    expect(error.mock.calls.flat().map(String).join(' ')).toContain('network down')
  })
})
