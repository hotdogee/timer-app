/**
 * What the account UI tells the user when something fails: the auth state's own reasons
 * (`AuthError`, which the store already sorted out of Better Auth's answers), a failed server-copy
 * download, and the device approval's errors, which come raw from Better Auth's device client
 * (`{ error, error_description, status }`) or a rejected `fetch` (offline) and are sorted into a few
 * kinds here. Each has a message in the active locale. Unknown shapes become `'unknown'`, never an
 * exception.
 */
import { m } from '../../i18n'
import { ServerCopyError } from './server-copy'
import type { AuthError } from './types'

/** Why approving or denying a device failed. */
export type DeviceErrorKind =
  | 'invalid-code'
  | 'expired-code'
  | 'already-used'
  | 'not-yours'
  | 'signed-out'
  | 'rate-limited'
  | 'network'
  | 'unknown'

/** What an error says about itself: its codes and texts in `UPPER_SNAKE` form, and its status. */
interface ErrorFacts {
  readonly tokens: ReadonlySet<string>
  readonly status: number | undefined
  readonly network: boolean
}

/** `'Invalid OTP'`, `'invalid-code'` → `'INVALID_OTP'`, `'INVALID_CODE'`. */
function token(text: string): string {
  return text
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

/** Texts a failed `fetch` rejects with: Chromium, Firefox and Safari. */
const NETWORK_MESSAGES = new Set([
  'FAILED_TO_FETCH',
  'NETWORKERROR_WHEN_ATTEMPTING_TO_FETCH_RESOURCE',
  'LOAD_FAILED',
])

const NETWORK_TOKENS = new Set(['NETWORK', 'NETWORK_ERROR', 'OFFLINE', 'FETCH_FAILED'])

function facts(error: unknown): ErrorFacts {
  const tokens = new Set<string>()
  let status: number | undefined
  let network = false
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === 'string') {
      if (value.trim() !== '') tokens.add(token(value))
      return
    }
    if (typeof value !== 'object' || value === null || depth > 2) return
    const record = value as Record<string, unknown>
    if (typeof record.status === 'number' && status === undefined) status = record.status
    if (value instanceof TypeError) network = true
    for (const key of ['code', 'error', 'error_description', 'message', 'name']) {
      visit(record[key], depth + 1)
    }
  }
  visit(error, 0)
  for (const text of tokens) {
    if (NETWORK_MESSAGES.has(text) || NETWORK_TOKENS.has(text)) network = true
  }
  if (status === 0) network = true
  return { tokens, status, network }
}

function hasAny(facts: ErrorFacts, ...names: string[]): boolean {
  return names.some((name) => facts.tokens.has(name))
}

/** The kind of a failed device approval or denial. */
export function deviceErrorKind(error: unknown): DeviceErrorKind {
  const found = facts(error)
  if (hasAny(found, 'DEVICE_CODE_ALREADY_PROCESSED', 'ALREADY_PROCESSED', 'ALREADY_USED')) {
    return 'already-used'
  }
  if (
    hasAny(found, 'EXPIRED_TOKEN', 'USER_CODE_HAS_EXPIRED', 'EXPIRED_USER_CODE', 'EXPIRED_CODE')
  ) {
    return 'expired-code'
  }
  if (hasAny(found, 'ACCESS_DENIED', 'NOT_YOURS') || found.status === 403) return 'not-yours'
  if (
    hasAny(found, 'UNAUTHORIZED', 'AUTHENTICATION_REQUIRED', 'SIGNED_OUT') ||
    found.status === 401
  ) {
    return 'signed-out'
  }
  if (found.status === 429 || hasAny(found, 'RATE_LIMITED', 'TOO_MANY_REQUESTS')) {
    return 'rate-limited'
  }
  if (found.network) return 'network'
  if (hasAny(found, 'INVALID_USER_CODE', 'INVALID_REQUEST', 'INVALID_CODE', 'INVALID_GRANT')) {
    return 'invalid-code'
  }
  return 'unknown'
}

/** What to tell the user about a failed sign-in step, sign-out or deletion. */
export function authErrorMessage(kind: AuthError): string {
  switch (kind) {
    case 'invalid-email':
      return m.account_error_invalid_email()
    case 'invalid-code':
      return m.account_error_invalid_code()
    case 'expired-code':
      return m.account_error_expired_code()
    case 'too-many-attempts':
      return m.account_error_too_many_attempts()
    case 'rate-limited':
      return m.account_error_rate_limited()
    case 'too-many-codes':
      return m.account_error_too_many_codes()
    case 'unavailable':
      return m.account_error_unavailable()
    case 'session-expired':
      return m.account_error_session_expired()
    case 'oauth':
      return m.account_error_oauth()
    case 'network':
      return m.account_error_network()
    case 'unknown':
      return m.account_error_unknown()
  }
}

/** What to tell the user about a failed device approval or denial. */
export function deviceErrorMessage(kind: DeviceErrorKind): string {
  switch (kind) {
    case 'invalid-code':
      return m.device_error_invalid_code()
    case 'expired-code':
      return m.device_error_expired_code()
    case 'already-used':
      return m.device_error_already_used()
    case 'not-yours':
      return m.device_error_not_yours()
    case 'signed-out':
      return m.device_error_signed_out()
    case 'rate-limited':
      return m.device_error_rate_limited()
    case 'network':
      return m.account_error_network()
    case 'unknown':
      return m.account_error_unknown()
  }
}

/**
 * Why downloading the server copy failed: signed out (the server answered 401: the session ended
 * elsewhere), no connection, or anything else.
 */
export function serverCopyErrorMessage(error: unknown): string {
  if (error instanceof ServerCopyError) {
    if (error.status === 401) return m.account_error_signed_out()
    return error.status >= 500 ? m.account_error_network() : m.account_error_unknown()
  }
  return facts(error).network ? m.account_error_network() : m.account_error_unknown()
}

/** Two sentences of the messages as one text, spaced the way the language spaces them. */
export function sentences(first: string, next: string): string {
  return m.account_sentences({ first, next })
}
