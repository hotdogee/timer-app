/**
 * The web half of the desktop sign-in (plan › Device approval page): the code a device shows,
 * read from the page's `?user_code=` and tidied for display, and the approve and deny calls on
 * Better Auth's device authorization client. The server only lets a signed-in user approve a code
 * that user has claimed, and claiming is `GET /device?user_code=` while signed in, so each call
 * claims first.
 */
import { DEVICE_USER_CODE_PARAM } from '../../sync/protocol'
import type { DeviceApprovalApi } from './types'

/** A Better Auth client call's answer: data, or an error with the server's body and status. */
interface ClientResult {
  readonly error?: unknown
}

/** The part of Better Auth's client (with `deviceAuthorizationClient()`) the approval calls. */
export interface DeviceClient {
  readonly device: ((input: { query: { user_code: string } }) => Promise<ClientResult>) & {
    readonly approve: (input: { userCode: string }) => Promise<ClientResult>
    readonly deny: (input: { userCode: string }) => Promise<ClientResult>
  }
}

/** Longest code worth sending; Better Auth's are 8 characters, a typo can make it longer. */
const MAX_CODE_LENGTH = 32

/**
 * A code as typed or pasted, tidied for the field: capitals, no spaces, at most a few dozen
 * characters. Dashes stay (`ABCD-EFGH`); the server ignores them.
 */
export function tidyUserCode(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase().slice(0, MAX_CODE_LENGTH)
}

/** The code in a page's query string (`?user_code=ABCD-EFGH`), tidied, or `''` when absent. */
export function userCodeFromSearch(search: string): string {
  return tidyUserCode(new URLSearchParams(search).get(DEVICE_USER_CODE_PARAM) ?? '')
}

/** Throws the error of a failed client call, so the caller's `catch` sees the server's reason. */
function unwrap(result: ClientResult): void {
  if (result.error !== null && result.error !== undefined) {
    // The server's error body ({ error, error_description, status }), for deviceErrorKind.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw result.error
  }
}

/** Approve and deny on Better Auth's client: claim the code, then decide. */
export function createDeviceApproval(client: DeviceClient): DeviceApprovalApi {
  async function claim(userCode: string): Promise<void> {
    unwrap(await client.device({ query: { user_code: userCode } }))
  }
  return {
    async approve(userCode) {
      await claim(userCode)
      unwrap(await client.device.approve({ userCode }))
    },
    async deny(userCode) {
      await claim(userCode)
      unwrap(await client.device.deny({ userCode }))
    },
  }
}

/**
 * A code from the desktop sign-in as the app shows it: Better Auth's eight characters in two
 * groups (`ABCD-EFGH`), easier to compare at a glance. Other codes are shown as they are. The
 * approval page and the server ignore the dash.
 */
export function formatUserCode(code: string): string {
  return /^[A-Z0-9]{8}$/i.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}`.toUpperCase() : code
}

/**
 * The code spelled out for screen readers, one character at a time (`A B C D, E F G H`), so it is
 * not read as a word.
 */
export function spellUserCode(code: string): string {
  return formatUserCode(code)
    .split('-')
    .map((group) => [...group].join(' '))
    .join(', ')
}
