import { describe, expect, it } from 'vitest'

import { SERVER_EXPORT_FORMAT, type ApiErrorResponse, type ServerExport } from '../src/protocol'
import { addCard, call, connectClient, eventually, signIn } from './helpers'

describe('GET /api/export', () => {
  it('answers 401 when signed out', async () => {
    for (const headers of [{}, { Authorization: 'Bearer not-a-token' }]) {
      const response = await call('/api/export', { headers })
      expect(response.status).toBe(401)
      const body: ApiErrorResponse = await response.json()
      expect(body).toEqual({ error: 'unauthorized' })
    }
  })

  it('returns the server copy of the synced store as a download', async () => {
    const user = await signIn()
    const device = await connectClient({ cookie: user.cookie })
    addCard(device.store, 'c1', 'Tea')
    device.store.setValue('sound', 'bell')
    await eventually(async () => {
      const response = await call('/api/export', { headers: { Cookie: user.cookie } })
      const body: ServerExport = await response.json()
      expect(body.tables.cards?.c1?.name).toBe('Tea')
    })
    await device.stop()

    const before = Date.now()
    const response = await call('/api/export', { headers: { Cookie: user.cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toMatch(/^application\/json/)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Disposition')).toMatch(
      /^attachment; filename="timer-app-server-copy-\d{4}-\d{2}-\d{2}\.json"$/,
    )
    const body: ServerExport = await response.json()
    expect(body).toEqual({
      app: 'timer-app',
      kind: 'server-copy',
      format: SERVER_EXPORT_FORMAT,
      exportedAt: body.exportedAt,
      tables: {
        cards: {
          c1: {
            kind: 'timer',
            name: 'Tea',
            createdAt: 1_700_000_000_000,
            muted: false,
            position: 0,
            phase: 'idle',
            duration: 300_000,
          },
        },
      },
      values: { sound: 'bell' },
    })
    expect(body.exportedAt).toBeGreaterThanOrEqual(before)
  })

  it('accepts a bearer token', async () => {
    const user = await signIn()
    const response = await call('/api/export', {
      headers: { Authorization: `Bearer ${user.token}` },
      origin: null,
    })
    expect(response.status).toBe(200)
  })

  it('is empty for a user who never synced', async () => {
    const user = await signIn()
    const response = await call('/api/export', { headers: { Cookie: user.cookie } })
    const body: ServerExport = await response.json()
    expect(body.tables).toEqual({})
    expect(body.values).toEqual({})
  })

  it('only serves GET', async () => {
    const user = await signIn()
    const response = await call('/api/export', {
      method: 'POST',
      headers: { Cookie: user.cookie },
    })
    expect(response.status).toBe(405)
  })
})
