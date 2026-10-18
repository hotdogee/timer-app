import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'

import { APPLE_ORIGIN, APPLE_SECRET_LIFETIME_SECONDS, createAppleClientSecret } from '../src/apple'

const credentials = {
  clientId: 'com.example.timer.web',
  teamId: 'TEAM123456',
  keyId: 'KEY1234567',
}

async function keyPair() {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
  return { pem: await exportPKCS8(privateKey), publicKey }
}

describe('createAppleClientSecret', () => {
  it('signs the ES256 JWT Apple expects, valid for 180 days', async () => {
    const { pem, publicKey } = await keyPair()
    const now = Date.UTC(2026, 9, 18)
    const secret = await createAppleClientSecret({ ...credentials, privateKey: pem }, now)

    expect(decodeProtectedHeader(secret)).toEqual({ alg: 'ES256', kid: credentials.keyId })
    const { payload } = await jwtVerify(secret, publicKey, {
      issuer: credentials.teamId,
      subject: credentials.clientId,
      audience: APPLE_ORIGIN,
      currentDate: new Date(now),
    })
    expect(payload.iat).toBe(now / 1000)
    expect(payload.exp).toBe(now / 1000 + APPLE_SECRET_LIFETIME_SECONDS)
    // Apple rejects secrets that live longer than 15777000 seconds.
    expect(APPLE_SECRET_LIFETIME_SECONDS).toBeLessThanOrEqual(15_777_000)
  })

  it('accepts the key on one line with literal \\n breaks, as a secret is often stored', async () => {
    const { pem, publicKey } = await keyPair()
    const oneLine = pem.trim().replace(/\n/g, '\\n')
    expect(oneLine).not.toContain('\n')
    const secret = await createAppleClientSecret({ ...credentials, privateKey: oneLine })
    await expect(jwtVerify(secret, publicKey, { audience: APPLE_ORIGIN })).resolves.toBeTruthy()
  })

  it('rejects a key that is not PKCS #8', async () => {
    await expect(
      createAppleClientSecret({ ...credentials, privateKey: 'not a key' }),
    ).rejects.toThrow()
  })
})
