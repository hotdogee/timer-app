import { afterEach, describe, expect, it, vi } from 'vitest'

import { PRIVACY_POLICY_PATH, PRIVACY_POLICY_URL, privacyPolicyUrl } from './privacy'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the privacy policy URL', () => {
  it('is the page /privacy of the same origin on the web', () => {
    expect(PRIVACY_POLICY_PATH).toBe('/privacy')
    expect(PRIVACY_POLICY_URL).toBe('/privacy')
    expect(privacyPolicyUrl('')).toBe('/privacy')
  })

  it("is the production site's page in a desktop build, whose API origin is that site", () => {
    vi.stubEnv('VITE_API_ORIGIN', 'https://timer.hanlin.uk/')
    expect(privacyPolicyUrl()).toBe('https://timer.hanlin.uk/privacy')
    expect(privacyPolicyUrl('https://timer.hanlin.uk')).toBe('https://timer.hanlin.uk/privacy')
  })
})
