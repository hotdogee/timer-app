import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import type { TimeResponse } from '../src/protocol'

describe('GET /api/time', () => {
  it('answers with the server clock and is never cached', async () => {
    const before = Date.now()
    const response = await exports.default.fetch('http://localhost/api/time')
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin')
    const body: TimeResponse = await response.json()
    expect(body.now).toBeGreaterThanOrEqual(before)
    expect(body.now).toBeLessThanOrEqual(Date.now())
  })

  it('only answers GET', async () => {
    const response = await exports.default.fetch('http://localhost/api/time', { method: 'POST' })
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('GET')
  })

  it('runs with the test variables', () => {
    expect(env.APP_ENV).toBe('development')
  })
})
