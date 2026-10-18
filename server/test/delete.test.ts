import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { DESKTOP_CLIENT_ID } from '../src/protocol'
import { addressKey } from '../src/send-limit'
import { STORE_TABLE, WIPED_CLOSE_CODE, WIPED_CLOSE_REASON } from '../src/sync-object'
import {
  addCard,
  call,
  connectClient,
  eventually,
  expectRefused,
  openSync,
  requestCode,
  signIn,
  stubOf,
} from './helpers'

/** Rows of `table` whose `column` equals `value`. */
async function count(table: string, column: string, value: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM "${table}" WHERE "${column}" = ?`)
    .bind(value)
    .first<{ n: number }>()
  return row?.n ?? -1
}

/** The user tables in a Durable Object's SQLite storage (internal `_cf_` tables left out). */
function storedTables(userId: string): Promise<string[]> {
  return runInDurableObject(stubOf(userId), (_instance, state) =>
    state.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .toArray()
      .map((row) => row.name)
      .filter((name) => !name.startsWith('_cf_') && !name.startsWith('sqlite_')),
  )
}

describe('deleting the account', () => {
  it('wipes the synced data, disconnects every device and deletes every auth row', async () => {
    const user = await signIn()
    const device = await connectClient({ cookie: user.cookie })
    addCard(device.store, 'c1', 'Tea')
    await eventually(async () => {
      const { tables } = await stubOf(user.userId).exportContent()
      expect(tables.cards?.c1).toBeDefined()
    })
    expect(await storedTables(user.userId)).toContain(STORE_TABLE)

    // Leftovers Better Auth would not delete: an approved device code and a pending email code.
    const code: { user_code: string } = await (
      await call('/api/auth/device/code', { body: { client_id: DESKTOP_CLIENT_ID }, origin: null })
    ).json()
    // Opening the code on the /device page claims it for the signed-in user.
    const claimed = await call(`/api/auth/device?user_code=${code.user_code}`, {
      headers: { Cookie: user.cookie },
    })
    expect(claimed.status).toBe(200)
    expect(await count('deviceCode', 'userId', user.userId)).toBe(1)
    await requestCode(user.email)
    expect(await count('verification', 'identifier', `sign-in-otp-${user.email}`)).toBe(1)
    const sendCounter = await addressKey(user.email)
    expect(await count('sendLimit', 'key', sendCounter)).toBe(1)

    const response = await call('/api/auth/delete-user', {
      body: {},
      headers: { Cookie: user.cookie },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true, message: 'User deleted' })

    const closed = await device.closed
    expect(closed.code).toBe(WIPED_CLOSE_CODE)
    expect(closed.reason).toBe(WIPED_CLOSE_REASON)

    // The Durable Object holds nothing, now and after a restart.
    expect(await storedTables(user.userId)).toEqual([])
    expect(await stubOf(user.userId).exportContent()).toEqual({ tables: {}, values: {} })
    await evictDurableObject(stubOf(user.userId))
    expect(await stubOf(user.userId).exportContent()).toEqual({ tables: {}, values: {} })

    // D1 holds nothing about the user.
    expect(await count('user', 'id', user.userId)).toBe(0)
    expect(await count('session', 'userId', user.userId)).toBe(0)
    expect(await count('account', 'userId', user.userId)).toBe(0)
    expect(await count('deviceCode', 'userId', user.userId)).toBe(0)
    expect(await count('verification', 'identifier', `sign-in-otp-${user.email}`)).toBe(0)
    expect(await count('sendLimit', 'key', sendCounter)).toBe(0)
  })

  it('leaves the old credentials worthless', async () => {
    const user = await signIn()
    const response = await call('/api/auth/delete-user', {
      body: {},
      headers: { Cookie: user.cookie },
    })
    expect(response.status).toBe(200)
    expect((await call('/api/export', { headers: { Cookie: user.cookie } })).status).toBe(401)
    expect(
      (await call('/api/export', { headers: { Authorization: `Bearer ${user.token}` } })).status,
    ).toBe(401)
    await expectRefused(await openSync({ cookie: user.cookie }))
  })

  it('lets the same address start over with a new, empty account', async () => {
    const before = await signIn()
    const device = await connectClient({ cookie: before.cookie })
    addCard(device.store, 'c1', 'Tea')
    await eventually(async () => {
      const { tables } = await stubOf(before.userId).exportContent()
      expect(tables.cards?.c1).toBeDefined()
    })
    await call('/api/auth/delete-user', { body: {}, headers: { Cookie: before.cookie } })
    await device.closed

    const after = await signIn(before.email)
    expect(after.userId).not.toBe(before.userId)
    const exported: { tables: object } = await (
      await call('/api/export', { headers: { Cookie: after.cookie } })
    ).json()
    expect(exported.tables).toEqual({})
  })

  it('needs a session from a trusted origin', async () => {
    const user = await signIn()
    expect((await call('/api/auth/delete-user', { body: {} })).status).toBe(401)
    const forged = await call('/api/auth/delete-user', {
      body: {},
      headers: { Cookie: user.cookie },
      origin: 'https://evil.example',
    })
    expect(forged.status).toBe(403)
    expect(await count('user', 'id', user.userId)).toBe(1)
  })
})
