import { describe, expect, it } from 'vitest'

import { authOptions, COOKIE_PREFIX, SEND_CODE_PATH } from '../src/auth-options'

const options = authOptions({
  baseURL: 'http://localhost:8787',
  secret: 'test-only-placeholder-secret-0123456789abcdef',
  trustedOrigins: ['http://localhost:8787'],
  socialProviders: {},
  sendCode: () => Promise.resolve(),
  allowCodeEmail: () => Promise.resolve(),
  endSession: () => Promise.resolve(),
  wipeUser: () => Promise.resolve(),
  purgeUser: () => Promise.resolve(),
  runInBackground: () => undefined,
})

describe('authOptions', () => {
  it('keeps Better Auth from caching D1 work across requests', () => {
    // With the runtime schema check on, the first request starts a D1 query that later requests
    // await; the Worker cancels it when that first request ends and every later auth request
    // hangs. The Vitest integration does not reproduce that (only `wrangler dev` and production
    // do), so this guards the option instead.
    expect(options.advanced.database.validateSchema).toBe(false)
  })

  it('never lets an environment variable switch the CSRF and origin checks off', () => {
    expect(options.advanced.disableOriginCheck).toBe(false)
    expect(options.advanced.disableCSRFCheck).toBe(false)
  })

  it('sends OAuth failures it cannot hand to the app’s callback to the app, not its own page', () => {
    expect(options.onAPIError.errorURL).toBe('http://localhost:8787/')
  })

  it('resends a pending code instead of replacing it, so nobody can kill another’s code', () => {
    const plugin: { options?: unknown } | undefined = options.plugins.find(
      (entry) => entry.id === 'email-otp',
    )
    expect(plugin?.options).toMatchObject({ storeOTP: 'encrypted', resendStrategy: 'reuse' })
  })

  it('has rate limits of its own for the code, sign-in and device endpoints', () => {
    const rules = options.rateLimit.customRules
    expect(rules[SEND_CODE_PATH]).toEqual({ window: 60, max: 3 })
    expect(rules['/sign-in/email-otp']).toEqual({ window: 60, max: 10 })
    expect(rules['/device']).toEqual({ window: 60, max: 10 })
    expect(rules['/device/code']).toEqual({ window: 60, max: 5 })
  })

  it('names the cookies after the app and has no passwords or telemetry', () => {
    expect(options.advanced.cookiePrefix).toBe(COOKIE_PREFIX)
    expect(options.emailAndPassword.enabled).toBe(false)
    expect(options.telemetry.enabled).toBe(false)
  })
})
