/**
 * Unique ids for cards. Prefers `crypto.randomUUID()`, which browsers expose only in secure
 * contexts (HTTPS and localhost), so the dev server opened over a LAN address on a phone falls back
 * to `crypto.getRandomValues`, and as a last resort to `Math.random`. Every path yields an RFC 9562
 * version 4 UUID string.
 */

/** Produces ids that are unique across devices (they are used as sync keys from M4). */
export interface IdSource {
  newId(): string
}

/** The parts of Web Crypto this module uses; either may be missing. */
export interface CryptoLike {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => unknown
}

/** Formats 16 random bytes as a version 4 UUID, setting the version and variant bits. */
export function uuidFromBytes(bytes: Uint8Array): string {
  const b = Array.from({ length: 16 }, (_, i) => bytes[i] ?? 0)
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80
  const hex = b.map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Creates an id source from `crypto` (the global Web Crypto by default; null when there is none)
 * with `random` as the last resort.
 */
export function createIdSource(
  crypto: CryptoLike | null = (globalThis as { crypto?: CryptoLike }).crypto ?? null,
  random: () => number = Math.random,
): IdSource {
  return {
    newId() {
      if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
      const bytes = new Uint8Array(16)
      if (typeof crypto?.getRandomValues === 'function') {
        crypto.getRandomValues(bytes)
      } else {
        for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(random() * 256)
      }
      return uuidFromBytes(bytes)
    },
  }
}
