import { describe, expect, it } from 'vitest'

import { AUTH_SUBPROTOCOL_PREFIX, syncSubprotocols, tokenFromSubprotocols } from '../src/protocol'
import { signIn } from './helpers'

/** An HTTP token (RFC 9110 tchar): what a WebSocket subprotocol name must be. */
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

describe('the token subprotocol', () => {
  it('encodes any token as a valid subprotocol name and reads it back', () => {
    for (const token of [
      'abc.def',
      'AbC123.sig/with+base64=',
      'a b,c;d"e(f)g[h]i{j}k@l:m?n\\o',
      "it's!*()",
      'ünïcödé',
    ]) {
      const offered = syncSubprotocols(token)
      for (const protocol of offered) expect(protocol).toMatch(HTTP_TOKEN)
      expect(tokenFromSubprotocols(offered.join(', '))).toBe(token)
    }
  })

  it('works for the real session token a sign-in hands out', async () => {
    const { token } = await signIn()
    const offered = syncSubprotocols(token)
    for (const protocol of offered) expect(protocol).toMatch(HTTP_TOKEN)
    expect(tokenFromSubprotocols(offered.join(','))).toBe(token)
  })

  it('reads a malformed entry as no token', () => {
    expect(tokenFromSubprotocols(`timer-sync, ${AUTH_SUBPROTOCOL_PREFIX}%E0%A4%A`)).toBeNull()
  })
})
