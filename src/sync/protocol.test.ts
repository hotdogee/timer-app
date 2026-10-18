import { describe, expect, it } from 'vitest'

import serverText from '../../server/src/protocol.ts?raw'
import {
  API_PATHS,
  AUTH_SUBPROTOCOL_PREFIX,
  isProvider,
  PROVIDERS,
  SYNC_SUBPROTOCOL,
  syncSubprotocols,
  tokenFromSubprotocols,
} from './protocol'
import clientText from './protocol.ts?raw'

describe('protocol.ts', () => {
  it('is byte for byte the same file in the client and the server', () => {
    expect(clientText.length).toBeGreaterThan(0)
    expect(clientText).toBe(serverText)
  })

  it('keeps every API path under /api except the dev-only endpoint', () => {
    for (const [name, path] of Object.entries(API_PATHS)) {
      expect(path.startsWith(name === 'devOtp' ? '/__dev/' : '/api/')).toBe(true)
    }
  })
})

describe('syncSubprotocols', () => {
  it('offers only the sync protocol without a token', () => {
    expect(syncSubprotocols()).toEqual([SYNC_SUBPROTOCOL])
    expect(syncSubprotocols(null)).toEqual([SYNC_SUBPROTOCOL])
    expect(syncSubprotocols('')).toEqual([SYNC_SUBPROTOCOL])
  })

  it('adds the token as a prefixed protocol', () => {
    expect(syncSubprotocols('abc.def')).toEqual([SYNC_SUBPROTOCOL, 'timer-auth.abc.def'])
  })
})

describe('tokenFromSubprotocols', () => {
  it('reads the token back from what the client offers', () => {
    expect(tokenFromSubprotocols(syncSubprotocols('abc.def-_1').join(', '))).toBe('abc.def-_1')
  })

  it('returns null when no token is offered', () => {
    expect(tokenFromSubprotocols(null)).toBeNull()
    expect(tokenFromSubprotocols(undefined)).toBeNull()
    expect(tokenFromSubprotocols('')).toBeNull()
    expect(tokenFromSubprotocols(SYNC_SUBPROTOCOL)).toBeNull()
    expect(tokenFromSubprotocols(`${SYNC_SUBPROTOCOL}, ${AUTH_SUBPROTOCOL_PREFIX}`)).toBeNull()
  })

  it('takes the first token and tolerates spacing', () => {
    expect(tokenFromSubprotocols('timer-auth.one,timer-auth.two')).toBe('one')
    expect(tokenFromSubprotocols('  timer-sync ,   timer-auth.x  ')).toBe('x')
  })

  it('ignores protocols that only contain the prefix later in the name', () => {
    expect(tokenFromSubprotocols('my-timer-auth.x')).toBeNull()
  })
})

describe('isProvider', () => {
  it('accepts every known provider and nothing else', () => {
    for (const provider of PROVIDERS) expect(isProvider(provider)).toBe(true)
    for (const value of ['', 'Google', 'email', 'facebook', null, undefined, 1, {}]) {
      expect(isProvider(value)).toBe(false)
    }
  })
})
