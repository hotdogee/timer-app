import { describe, expect, it } from 'vitest'

import { DESKTOP_CLIENT_ID, SYNC_SUBPROTOCOL, syncSubprotocols } from '../src/protocol'
import { ORIGIN, call, freshIp, openSync, signIn } from './helpers'

interface DeviceCodeBody {
  readonly device_code: string
  readonly user_code: string
  readonly verification_uri: string
  readonly verification_uri_complete: string
  readonly expires_in: number
  readonly interval: number
}

interface TokenBody {
  readonly access_token?: string
  readonly token_type?: string
  readonly error?: string
}

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/** Starts a device sign-in the way the desktop app does (no browser, no Origin). */
async function deviceCode(clientId: string = DESKTOP_CLIENT_ID): Promise<Response> {
  return call('/api/auth/device/code', { body: { client_id: clientId }, origin: null })
}

function pollToken(code: string): Promise<Response> {
  return call('/api/auth/device/token', {
    body: { grant_type: GRANT_TYPE, device_code: code, client_id: DESKTOP_CLIENT_ID },
    origin: null,
  })
}

describe('device sign-in (the desktop app through the browser)', () => {
  it('issues a code that points at the /device page', async () => {
    const response = await deviceCode()
    expect(response.status).toBe(200)
    const body: DeviceCodeBody = await response.json()
    expect(body.verification_uri).toBe(`${ORIGIN}/device`)
    const complete = new URL(body.verification_uri_complete)
    expect(complete.pathname).toBe('/device')
    expect(complete.searchParams.get('user_code')).toBe(body.user_code)
    expect(body.expires_in).toBe(15 * 60)
    expect(body.interval).toBe(5)
  })

  it('only serves the desktop client id', async () => {
    const response = await deviceCode('someone-else')
    expect(response.status).toBe(400)
    const body: { error: string } = await response.json()
    expect(body.error).toBe('invalid_client')
  })

  it('stays pending until a signed-in user approves it', async () => {
    const body: DeviceCodeBody = await (await deviceCode()).json()
    const pending = await pollToken(body.device_code)
    expect(pending.status).toBe(400)
    const token: TokenBody = await pending.json()
    expect(token.error).toBe('authorization_pending')
  })

  it('turns an approval into a bearer token for the API and the sync socket', async () => {
    const user = await signIn()
    const code: DeviceCodeBody = await (await deviceCode()).json()

    const check = await call(`/api/auth/device?user_code=${code.user_code}`, {
      headers: { Cookie: user.cookie },
    })
    expect(check.status).toBe(200)
    const approve = await call('/api/auth/device/approve', {
      body: { userCode: code.user_code },
      headers: { Cookie: user.cookie },
    })
    expect(approve.status).toBe(200)

    const response = await pollToken(code.device_code)
    expect(response.status).toBe(200)
    const token: TokenBody = await response.json()
    expect(token.token_type).toBe('Bearer')
    const accessToken = token.access_token ?? ''
    expect(accessToken).not.toBe('')

    const exported = await call('/api/export', {
      headers: { Authorization: `Bearer ${accessToken}` },
      origin: null,
    })
    expect(exported.status).toBe(200)

    const socket = await openSync({ protocols: syncSubprotocols(accessToken), origin: null })
    expect(socket.status).toBe(101)
    expect(socket.headers.get('Sec-WebSocket-Protocol')).toBe(SYNC_SUBPROTOCOL)
    socket.webSocket?.accept()
    socket.webSocket?.close()
  })

  it('needs the code opened on the /device page (claimed) before it can be approved', async () => {
    const user = await signIn()
    const code: DeviceCodeBody = await (await deviceCode()).json()
    const approve = await call('/api/auth/device/approve', {
      body: { userCode: code.user_code },
      headers: { Cookie: user.cookie },
    })
    expect(approve.status).toBe(400)
  })

  it('refuses an approval without a session', async () => {
    const code: DeviceCodeBody = await (await deviceCode()).json()
    const approve = await call('/api/auth/device/approve', { body: { userCode: code.user_code } })
    expect(approve.status).toBe(401)
  })
})

describe('device sign-in rate limits', () => {
  it('lets one client claim codes ten times a minute, not five a quarter hour', async () => {
    const user = await signIn()
    const ip = freshIp()
    const claim = (): Promise<Response> =>
      call('/api/auth/device?user_code=NOTACODE', { headers: { Cookie: user.cookie }, ip })
    for (let i = 0; i < 10; i++) expect((await claim()).status).not.toBe(429)
    const limited = await claim()
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('X-Retry-After'))).toBeLessThanOrEqual(60)
  })

  it('lets one client start five device sign-ins a minute', async () => {
    const ip = freshIp()
    const start = (): Promise<Response> =>
      call('/api/auth/device/code', { body: { client_id: DESKTOP_CLIENT_ID }, origin: null, ip })
    for (let i = 0; i < 5; i++) expect((await start()).status).toBe(200)
    expect((await start()).status).toBe(429)
  })
})
