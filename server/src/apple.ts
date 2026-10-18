/**
 * Sign in with Apple uses a signed JWT as the OAuth client secret: ES256 with the `.p8` key from the
 * Apple Developer account, issued by the team, for the Services ID, valid for at most six months.
 * https://developer.apple.com/documentation/accountorganizationaldatamanagement/creating-a-client-secret
 */
import { SignJWT, importPKCS8 } from 'jose'

/** The `aud` claim Apple requires, also the origin of its `form_post` callback. */
export const APPLE_ORIGIN = 'https://appleid.apple.com'

/** Lifetime of the generated client secret: 180 days (Apple's limit is 15777000 s, about 182). */
export const APPLE_SECRET_LIFETIME_SECONDS = 180 * 24 * 60 * 60

export interface AppleCredentials {
  /** The Services ID (`APPLE_CLIENT_ID`). */
  readonly clientId: string
  readonly teamId: string
  readonly keyId: string
  /** The `.p8` key in PEM form; literal `\n` sequences (one-line secrets) are turned into breaks. */
  readonly privateKey: string
}

/** Signs the Apple client secret. Rejects when the key is not an ES256 PKCS #8 key. */
export async function createAppleClientSecret(
  credentials: AppleCredentials,
  now: number = Date.now(),
): Promise<string> {
  const pem = credentials.privateKey.replace(/\\n/g, '\n').trim()
  const key = await importPKCS8(pem, 'ES256')
  const issuedAt = Math.floor(now / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: credentials.keyId })
    .setIssuer(credentials.teamId)
    .setSubject(credentials.clientId)
    .setAudience(APPLE_ORIGIN)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + APPLE_SECRET_LIFETIME_SECONDS)
    .sign(key)
}
