/**
 * The OS credential store service against a fake shell: `@tauri-apps/api/mocks` routes the
 * commands the real module invokes (`token_get`, `token_set`, `token_clear`) to a recorder.
 */
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import type { settings } from '../../core'
import { createTauriTokenStore } from './token-store'

type Payload = Record<string, unknown>

const AUTH: settings.DeviceAuth = { token: 'session-token.1', expiresAt: 2_000_000_000_000 }

/** A command failing as Tauri's do: rejecting with its message, a string. */
function refuse(message: string): Promise<never> {
  // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- as Tauri does
  return Promise.reject(message)
}

/** A shell that answers `token_*` from one stored value, recording every command. */
function fakeShell(options: { stored?: unknown; fail?: string } = {}) {
  const calls: [string, Payload][] = []
  let stored: unknown = options.stored ?? null
  mockIPC((cmd, args) => {
    const payload = (args ?? {}) as Payload
    calls.push([cmd, payload])
    if (cmd === options.fail) return refuse('the credential store failed: locked')
    switch (cmd) {
      case 'token_get':
        return stored
      case 'token_set':
        stored = payload.auth
        return null
      case 'token_clear':
        stored = null
        return null
      default:
        return refuse(`Command ${cmd} not found`)
    }
  })
  return {
    calls,
    commands: () => calls.map(([cmd]) => cmd),
    get stored() {
      return stored
    },
  }
}

let warn: MockInstance<typeof console.warn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  mockWindows('main')
})

afterEach(() => {
  clearMocks()
  vi.restoreAllMocks()
})

describe('createTauriTokenStore', () => {
  it('touches nothing until used, and is supported', () => {
    const shell = fakeShell()
    const tokens = createTauriTokenStore()
    expect(tokens.supported).toBe(true)
    expect(shell.calls).toEqual([])
  })

  it('stores, reads back and clears the token through the shell', async () => {
    const shell = fakeShell()
    const tokens = createTauriTokenStore()
    await expect(tokens.get()).resolves.toBeNull()
    await expect(tokens.set(AUTH)).resolves.toBe(true)
    await expect(tokens.get()).resolves.toEqual(AUTH)
    await expect(tokens.clear()).resolves.toBe(true)
    await expect(tokens.get()).resolves.toBeNull()
    expect(shell.calls).toEqual([
      ['token_get', {}],
      ['token_set', { auth: AUTH }],
      ['token_get', {}],
      ['token_clear', {}],
      ['token_get', {}],
    ])
    expect(warn).not.toHaveBeenCalled()
  })

  it('sends only the token and its expiry', async () => {
    const shell = fakeShell()
    const tokens = createTauriTokenStore()
    const extra = { ...AUTH, user: 'ann@example.com' } as settings.DeviceAuth
    await tokens.set(extra)
    expect(shell.calls).toEqual([['token_set', { auth: AUTH }]])
  })

  it('reads an entry that is not a valid token as none', async () => {
    for (const stored of [
      'session-token',
      { token: '', expiresAt: 1 },
      { token: 'has space', expiresAt: 1 },
      { token: 'abc', expiresAt: 0 },
      { token: 'abc' },
      42,
    ]) {
      fakeShell({ stored })
      await expect(createTauriTokenStore().get()).resolves.toBeNull()
    }
    expect(warn).not.toHaveBeenCalled()
  })

  it('runs the calls one at a time, in the order made', async () => {
    const order: string[] = []
    let answer: () => void = () => undefined
    mockIPC((cmd) => {
      order.push(`start ${cmd}`)
      if (cmd !== 'token_get') {
        order.push(`end ${cmd}`)
        return null
      }
      return new Promise((resolve) => {
        answer = () => {
          order.push(`end ${cmd}`)
          resolve(AUTH)
        }
      })
    })
    const tokens = createTauriTokenStore()
    const read = tokens.get()
    const cleared = tokens.clear()
    const stored = tokens.set(AUTH)
    await vi.waitFor(() => {
      expect(order).toEqual(['start token_get'])
    })
    answer()
    await expect(read).resolves.toEqual(AUTH)
    await expect(cleared).resolves.toBe(true)
    await expect(stored).resolves.toBe(true)
    expect(order).toEqual([
      'start token_get',
      'end token_get',
      'start token_clear',
      'end token_clear',
      'start token_set',
      'end token_set',
    ])
  })

  it('turns off for good with one warning when the store fails, and never rejects', async () => {
    const shell = fakeShell({ fail: 'token_set' })
    const tokens = createTauriTokenStore()
    await expect(tokens.get()).resolves.toBeNull()
    await expect(tokens.set(AUTH)).resolves.toBe(false)
    expect(tokens.supported).toBe(false)
    await expect(tokens.get()).resolves.toBeNull()
    await expect(tokens.clear()).resolves.toBe(false)
    await expect(tokens.set(AUTH)).resolves.toBe(false)
    expect(shell.commands()).toEqual(['token_get', 'token_set'])
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('OS credential store failed')
    // The warning carries the shell's message, never the token.
    expect(warn.mock.calls[0]?.slice(1)).toEqual(['the credential store failed: locked'])
  })

  it('turns off when reading fails (no credential store on this desktop)', async () => {
    fakeShell({ fail: 'token_get' })
    const tokens = createTauriTokenStore()
    await expect(tokens.get()).resolves.toBeNull()
    expect(tokens.supported).toBe(false)
    expect(warn).toHaveBeenCalledOnce()
  })

  it('turns off when the shell code fails to load', async () => {
    const shell = fakeShell()
    const tokens = createTauriTokenStore(() => Promise.reject(new Error('chunk failed')))
    await expect(tokens.get()).resolves.toBeNull()
    await expect(tokens.set(AUTH)).resolves.toBe(false)
    expect(tokens.supported).toBe(false)
    expect(shell.calls).toEqual([])
    expect(warn).toHaveBeenCalledOnce()
  })
})
