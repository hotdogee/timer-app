import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiOrigin, apiUrl, wsUrl } from './api'
import { API_PATHS } from './protocol'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('apiOrigin', () => {
  it('is the page origin (empty) unless VITE_API_ORIGIN is set', () => {
    expect(apiOrigin()).toBe('')
  })

  it('reads VITE_API_ORIGIN without trailing slashes or spaces', () => {
    vi.stubEnv('VITE_API_ORIGIN', ' https://timer.example.com// ')
    expect(apiOrigin()).toBe('https://timer.example.com')
    expect(apiUrl(API_PATHS.time)).toBe('https://timer.example.com/api/time')
    expect(wsUrl(API_PATHS.sync)).toBe('wss://timer.example.com/api/sync')
  })
})

describe('apiUrl', () => {
  it('is the path itself on the same origin', () => {
    expect(apiUrl(API_PATHS.config, '')).toBe('/api/config')
  })

  it('prefixes another origin', () => {
    expect(apiUrl(API_PATHS.export, 'http://127.0.0.1:8787')).toBe(
      'http://127.0.0.1:8787/api/export',
    )
  })
})

describe('wsUrl', () => {
  it('uses the page host, ws: on http and wss: on https', () => {
    expect(wsUrl(API_PATHS.sync, '', { protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/sync',
    )
    expect(wsUrl(API_PATHS.sync, '', { protocol: 'https:', host: 'timer.example.com' })).toBe(
      'wss://timer.example.com/api/sync',
    )
  })

  it('turns an http(s) API origin into ws(s)', () => {
    const page = { protocol: 'https:', host: 'ignored.example' }
    expect(wsUrl('/api/sync', 'http://127.0.0.1:8787', page)).toBe('ws://127.0.0.1:8787/api/sync')
    expect(wsUrl('/api/sync', 'HTTPS://Timer.example.com', page)).toBe(
      'wss://Timer.example.com/api/sync',
    )
  })

  it('throws without an origin or a page', () => {
    expect(() => wsUrl('/api/sync', '', undefined)).toThrow(/no API origin/)
  })
})
