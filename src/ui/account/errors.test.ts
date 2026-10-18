import { afterEach, describe, expect, it } from 'vitest'

import { setAppLocale } from '../../i18n'
import {
  authErrorMessage,
  deviceErrorKind,
  deviceErrorMessage,
  sentences,
  serverCopyErrorMessage,
  type DeviceErrorKind,
} from './errors'
import { ServerCopyError } from './server-copy'
import type { AuthError } from './types'

afterEach(() => {
  setAppLocale('en')
})

describe('deviceErrorKind', () => {
  it('reads the device plugin’s errors', () => {
    const cases: [unknown, DeviceErrorKind][] = [
      [
        { error: 'invalid_request', error_description: 'Invalid user code', status: 400 },
        'invalid-code',
      ],
      [
        { error: 'expired_token', error_description: 'User code has expired', status: 400 },
        'expired-code',
      ],
      [
        {
          error: 'invalid_request',
          error_description: 'Device code already processed',
          status: 400,
        },
        'already-used',
      ],
      [{ error: 'access_denied', status: 403 }, 'not-yours'],
      [
        { error: 'unauthorized', error_description: 'Authentication required', status: 401 },
        'signed-out',
      ],
      [{ status: 429, message: 'Too many requests.' }, 'rate-limited'],
      [new TypeError('Failed to fetch'), 'network'],
      [{ status: 500 }, 'unknown'],
      [undefined, 'unknown'],
    ]
    for (const [error, kind] of cases)
      expect(deviceErrorKind(error), JSON.stringify(error)).toBe(kind)
  })
})

describe('messages', () => {
  it('has a message for every kind, in the active locale', () => {
    const auth: AuthError[] = [
      'invalid-email',
      'invalid-code',
      'expired-code',
      'too-many-attempts',
      'rate-limited',
      'too-many-codes',
      'unavailable',
      'session-expired',
      'oauth',
      'network',
      'unknown',
    ]
    const device: DeviceErrorKind[] = [
      'invalid-code',
      'expired-code',
      'already-used',
      'not-yours',
      'signed-out',
      'rate-limited',
      'network',
      'unknown',
    ]
    const english = auth.map(authErrorMessage)
    expect(new Set(english).size).toBe(auth.length)
    expect(authErrorMessage('invalid-code')).toBe("That code isn't right. Check it and try again.")
    for (const kind of device) expect(deviceErrorMessage(kind)).not.toBe('')
    setAppLocale('ja')
    expect(authErrorMessage('network')).toBe(
      'サーバーに接続できません。接続を確認してもう一度お試しください。',
    )
    setAppLocale('zh-TW')
    expect(deviceErrorMessage('expired-code')).toBe('驗證碼已過期，請在裝置上重新開始登入。')
  })
})

describe('device rate limits', () => {
  it('ask for a few minutes, not one: the server blocks for longer', () => {
    expect(deviceErrorMessage('rate-limited')).toBe(
      'Too many tries. Wait a few minutes and try again.',
    )
  })
})

describe('serverCopyErrorMessage', () => {
  it('says to sign in again when the server no longer knows the session', () => {
    expect(serverCopyErrorMessage(new ServerCopyError(401, 'Unauthorized'))).toBe(
      'Your session has ended. Sign in again.',
    )
  })

  it('names a missing connection, and anything else as unknown', () => {
    const network = "Can't reach the server. Check your connection and try again."
    expect(serverCopyErrorMessage(new TypeError('Failed to fetch'))).toBe(network)
    expect(serverCopyErrorMessage(new ServerCopyError(502, 'Bad Gateway'))).toBe(network)
    expect(serverCopyErrorMessage(new ServerCopyError(0, 'not json'))).toBe(
      'Something went wrong. Try again.',
    )
    expect(serverCopyErrorMessage(undefined)).toBe('Something went wrong. Try again.')
  })
})

describe('sentences', () => {
  it('joins two sentences as the language does: a space in English, none after 。', () => {
    expect(sentences('One.', 'Two.')).toBe('One. Two.')
    setAppLocale('zh-TW')
    expect(sentences('一。', '二。')).toBe('一。二。')
    setAppLocale('ja')
    expect(sentences('一。', '二。')).toBe('一。二。')
  })
})
