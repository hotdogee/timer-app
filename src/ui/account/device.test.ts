import { describe, expect, it, vi } from 'vitest'

import { createDeviceApproval, tidyUserCode, userCodeFromSearch, type DeviceClient } from './device'
import { deviceErrorKind } from './errors'

describe('the user code', () => {
  it('is read from ?user_code=, tidied', () => {
    expect(userCodeFromSearch('?user_code=abcd-efgh')).toBe('ABCD-EFGH')
    expect(userCodeFromSearch('?user_code=ABCD%20EFGH&x=1')).toBe('ABCDEFGH')
    expect(userCodeFromSearch('')).toBe('')
    expect(userCodeFromSearch('?code=ABCD')).toBe('')
  })

  it('is tidied to capitals without spaces, and kept short', () => {
    expect(tidyUserCode(' ab cd ')).toBe('ABCD')
    expect(tidyUserCode('x'.repeat(100))).toHaveLength(32)
  })
})

type Answer = { data: unknown; error: null } | { data: null; error: Record<string, unknown> }

function fakeClient(answers: { verify?: Answer; approve?: Answer; deny?: Answer } = {}) {
  const ok = (data: unknown): Answer => ({ data, error: null })
  const calls: string[] = []
  const verify = vi.fn((input: { query: { user_code: string } }) => {
    calls.push(`verify ${input.query.user_code}`)
    return Promise.resolve(answers.verify ?? ok({ status: 'pending' }))
  })
  const device = Object.assign(verify, {
    approve: vi.fn((input: { userCode: string }) => {
      calls.push(`approve ${input.userCode}`)
      return Promise.resolve(answers.approve ?? ok({ success: true }))
    }),
    deny: vi.fn((input: { userCode: string }) => {
      calls.push(`deny ${input.userCode}`)
      return Promise.resolve(answers.deny ?? ok({ success: true }))
    }),
  })
  const client: DeviceClient = { device }
  return { client, calls }
}

describe('createDeviceApproval', () => {
  it('claims the code for the signed-in user, then approves it', async () => {
    const { client, calls } = fakeClient()
    await createDeviceApproval(client).approve('ABCD-EFGH')
    expect(calls).toEqual(['verify ABCD-EFGH', 'approve ABCD-EFGH'])
  })

  it('claims, then denies', async () => {
    const { client, calls } = fakeClient()
    await createDeviceApproval(client).deny('ABCD')
    expect(calls).toEqual(['verify ABCD', 'deny ABCD'])
  })

  it('rejects with the server’s reason when claiming fails, and goes no further', async () => {
    const error = { error: 'invalid_request', error_description: 'Invalid user code', status: 400 }
    const { client, calls } = fakeClient({ verify: { data: null, error } })
    const result = createDeviceApproval(client).approve('NOPE')
    await expect(result).rejects.toBe(error)
    expect(calls).toEqual(['verify NOPE'])
    expect(deviceErrorKind(await result.catch((reason: unknown) => reason))).toBe('invalid-code')
  })

  it('rejects with the server’s reason when the decision fails', async () => {
    const error = { error: 'access_denied', status: 403 }
    const { client } = fakeClient({ deny: { data: null, error } })
    await expect(createDeviceApproval(client).deny('ABCD')).rejects.toBe(error)
  })
})
