import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'

import { createIdSource, uuidFromBytes } from './ids'

/** RFC 9562 version 4: 8-4-4-4-12 lowercase hex, version nibble 4, variant bits 10. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidFromBytes', () => {
  it('formats bytes as a version 4 UUID, setting the version and variant bits', () => {
    expect(uuidFromBytes(new Uint8Array(16))).toBe('00000000-0000-4000-8000-000000000000')
    expect(uuidFromBytes(new Uint8Array(16).fill(0xff))).toBe(
      'ffffffff-ffff-4fff-bfff-ffffffffffff',
    )
  })

  it('always yields a well-formed UUID', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 16, maxLength: 16 }), (bytes) =>
        UUID_V4.test(uuidFromBytes(bytes)),
      ),
    )
  })

  it('pads a short array with zeros', () => {
    expect(uuidFromBytes(new Uint8Array([0xab]))).toBe('ab000000-0000-4000-8000-000000000000')
  })
})

describe('createIdSource', () => {
  it('uses crypto.randomUUID when available', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555')
    const ids = createIdSource({ randomUUID, getRandomValues: vi.fn() })
    expect(ids.newId()).toBe('11111111-2222-4333-8444-555555555555')
    expect(randomUUID).toHaveBeenCalledTimes(1)
  })

  it('falls back to getRandomValues outside secure contexts', () => {
    const getRandomValues = vi.fn((array: Uint8Array) => array.fill(0x5a))
    const ids = createIdSource({ getRandomValues })
    expect(ids.newId()).toBe('5a5a5a5a-5a5a-4a5a-9a5a-5a5a5a5a5a5a')
    expect(getRandomValues).toHaveBeenCalledTimes(1)
  })

  it('falls back to Math.random without Web Crypto', () => {
    const ids = createIdSource(null, () => 0.999)
    expect(ids.newId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(UUID_V4.test(createIdSource(null).newId())).toBe(true)
    expect(UUID_V4.test(createIdSource({}).newId())).toBe(true)
  })

  it('produces distinct well-formed ids from the real Web Crypto', () => {
    const ids = createIdSource()
    const seen = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const id = ids.newId()
      expect(id).toMatch(UUID_V4)
      seen.add(id)
    }
    expect(seen.size).toBe(1000)
  })

  it('produces distinct ids on the getRandomValues path', () => {
    const ids = createIdSource({ getRandomValues: (array) => crypto.getRandomValues(array) })
    const seen = new Set(Array.from({ length: 1000 }, () => ids.newId()))
    expect(seen.size).toBe(1000)
  })
})
