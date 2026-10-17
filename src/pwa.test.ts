import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  applyUpdate,
  createPwa,
  dismissOfflineReady,
  dismissUpdate,
  pwaState,
  registerPwa,
  type RegisterServiceWorker,
} from './pwa.svelte'

// The real module exists only inside a Vite build; this stands in for the default loader.
const virtualRegisterSW = vi.hoisted(() => vi.fn())
vi.mock('virtual:pwa-register', () => ({ registerSW: virtualRegisterSW }))

/** A fake `registerSW` that records its options, so tests can fire the worker's callbacks. */
function fakeRegisterSW() {
  const calls: RegisterSWOptions[] = []
  const update = vi.fn(() => Promise.resolve())
  const registerSW: RegisterServiceWorker = (options) => {
    calls.push(options)
    return update
  }
  /** The options of the one registration. */
  const options = (): RegisterSWOptions => {
    expect(calls).toHaveLength(1)
    const [first] = calls
    if (!first) throw new Error('registerSW was not called')
    return first
  }
  return { calls, update, registerSW, options, load: vi.fn(() => Promise.resolve(registerSW)) }
}

/** A controller that registers: web, production build, service workers available. */
function webPwa(fake = fakeRegisterSW()) {
  return { fake, pwa: createPwa({ kind: 'web', dev: false, supported: true, load: fake.load }) }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  virtualRegisterSW.mockReset()
})

describe('createPwa', () => {
  it('starts with nothing to report and loads nothing until register() runs', () => {
    const { fake, pwa } = webPwa()
    expect(pwa.state.updateReady).toBe(false)
    expect(pwa.state.offlineReady).toBe(false)
    expect(fake.load).not.toHaveBeenCalled()
  })

  it('registers immediately, with the update, offline and error callbacks', async () => {
    const { fake, pwa } = webPwa()
    await expect(pwa.register()).resolves.toBe(true)
    expect(fake.load).toHaveBeenCalledOnce()
    const options = fake.options()
    expect(options.immediate).toBe(true)
    expect(options.onNeedRefresh).toBeTypeOf('function')
    expect(options.onOfflineReady).toBeTypeOf('function')
    expect(options.onRegisterError).toBeTypeOf('function')
  })

  it('registers at most once', async () => {
    const { fake, pwa } = webPwa()
    const [first, second] = await Promise.all([pwa.register(), pwa.register()])
    expect([first, second]).toEqual([true, false])
    await expect(pwa.register()).resolves.toBe(false)
    expect(fake.load).toHaveBeenCalledOnce()
    expect(fake.calls).toHaveLength(1)
  })

  it('skips registration inside Tauri', async () => {
    const fake = fakeRegisterSW()
    const pwa = createPwa({ kind: 'tauri', dev: false, supported: true, load: fake.load })
    await expect(pwa.register()).resolves.toBe(false)
    expect(fake.load).not.toHaveBeenCalled()
  })

  it('skips registration under the dev server', async () => {
    const fake = fakeRegisterSW()
    const pwa = createPwa({ kind: 'web', dev: true, supported: true, load: fake.load })
    await expect(pwa.register()).resolves.toBe(false)
    expect(fake.load).not.toHaveBeenCalled()
  })

  it('skips registration where the browser has no service workers', async () => {
    const fake = fakeRegisterSW()
    const pwa = createPwa({ kind: 'web', dev: false, supported: false, load: fake.load })
    await expect(pwa.register()).resolves.toBe(false)
    expect(fake.load).not.toHaveBeenCalled()
  })

  it('detects service workers on navigator when not told', async () => {
    const fake = fakeRegisterSW()
    const options = { kind: 'web', dev: false, load: fake.load } as const
    // Node's navigator has no serviceWorker.
    await expect(createPwa(options).register()).resolves.toBe(false)
    vi.stubGlobal('navigator', { serviceWorker: {} })
    await expect(createPwa(options).register()).resolves.toBe(true)
    vi.stubGlobal('navigator', undefined)
    await expect(createPwa(options).register()).resolves.toBe(false)
    expect(fake.load).toHaveBeenCalledOnce()
  })

  it('reports a waiting update, applies it, and can be dismissed', async () => {
    const { fake, pwa } = webPwa()
    await pwa.register()
    fake.options().onNeedRefresh?.()
    expect(pwa.state.updateReady).toBe(true)
    expect(pwa.state.offlineReady).toBe(false)

    await pwa.applyUpdate()
    expect(fake.update).toHaveBeenCalledOnce()

    pwa.dismissUpdate()
    expect(pwa.state.updateReady).toBe(false)
    // A later update shows the prompt again.
    fake.options().onNeedRefresh?.()
    expect(pwa.state.updateReady).toBe(true)
  })

  it('reports the first offline install until dismissed', async () => {
    const { fake, pwa } = webPwa()
    await pwa.register()
    fake.options().onOfflineReady?.()
    expect(pwa.state.offlineReady).toBe(true)
    expect(pwa.state.updateReady).toBe(false)
    pwa.dismissOfflineReady()
    expect(pwa.state.offlineReady).toBe(false)
  })

  it('applyUpdate does nothing before registration', async () => {
    const { fake, pwa } = webPwa()
    await expect(pwa.applyUpdate()).resolves.toBeUndefined()
    expect(fake.update).not.toHaveBeenCalled()
  })

  it('logs a registration error as a warning instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { fake, pwa } = webPwa()
    await pwa.register()
    const error = new Error('SecurityError')
    expect(() => fake.options().onRegisterError?.(error)).not.toThrow()
    expect(warn).toHaveBeenCalledWith('Timer App: could not register the service worker', error)
    expect(pwa.state.updateReady).toBe(false)
    expect(pwa.state.offlineReady).toBe(false)
  })

  it('logs a failed load of the registration code and resolves false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = new Error('Failed to fetch dynamically imported module')
    const pwa = createPwa({
      kind: 'web',
      dev: false,
      supported: true,
      load: () => Promise.reject(error),
    })
    await expect(pwa.register()).resolves.toBe(false)
    expect(warn).toHaveBeenCalledWith(
      'Timer App: could not load the service worker registration',
      error,
    )
    await expect(pwa.applyUpdate()).resolves.toBeUndefined()
  })

  it('loads registerSW from virtual:pwa-register by default', async () => {
    const update = vi.fn(() => Promise.resolve())
    virtualRegisterSW.mockReturnValue(update)
    const pwa = createPwa({ kind: 'web', dev: false, supported: true })
    await expect(pwa.register()).resolves.toBe(true)
    expect(virtualRegisterSW).toHaveBeenCalledOnce()
    expect(virtualRegisterSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }))
    await pwa.applyUpdate()
    expect(update).toHaveBeenCalledOnce()
  })
})

describe('the app singleton', () => {
  it('starts with nothing to report', () => {
    expect(pwaState.updateReady).toBe(false)
    expect(pwaState.offlineReady).toBe(false)
  })

  it('skips registration under Vite dev mode, which Vitest runs in', async () => {
    expect(import.meta.env.DEV).toBe(true)
    vi.stubGlobal('navigator', { serviceWorker: {} })
    await expect(registerPwa()).resolves.toBe(false)
    expect(virtualRegisterSW).not.toHaveBeenCalled()
  })

  it('keeps its actions safe to call before registration', async () => {
    await expect(applyUpdate()).resolves.toBeUndefined()
    dismissUpdate()
    dismissOfflineReady()
    expect(pwaState.updateReady).toBe(false)
    expect(pwaState.offlineReady).toBe(false)
  })
})
