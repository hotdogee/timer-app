/**
 * The desktop app's update state (`createDesktopUpdates` in pwa.svelte.ts) over a fake updater:
 * an unconfigured build, checks (found, none, offline), install with progress, a failed install,
 * Later, and the schedule.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UpdateCheck, UpdateInfo, Updater, UpdateProgress } from './platform'
import {
  UPDATE_CHECK_EVERY_MS,
  UPDATE_FIRST_CHECK_MS,
  createDesktopUpdates,
  desktopUpdates,
} from './pwa.svelte'

const UPDATE: UpdateInfo = { version: '1.2.0', currentVersion: '1.1.0', notes: null, date: null }

function fakeUpdater(overrides: Partial<Updater> = {}) {
  let report: ((progress: UpdateProgress) => void) | undefined
  let finish: ((installed: boolean) => void) | undefined
  const updater = {
    supported: true,
    configured: vi.fn(() => Promise.resolve(true)),
    check: vi.fn<() => Promise<UpdateCheck>>(() => Promise.resolve(UPDATE)),
    install: vi.fn(
      (onProgress?: (progress: UpdateProgress) => void) =>
        new Promise<boolean>((resolve) => {
          report = onProgress
          finish = resolve
        }),
    ),
    restart: vi.fn(() => Promise.resolve()),
    ...overrides,
  } satisfies Updater
  return {
    updater,
    progress: (p: UpdateProgress) => report?.(p),
    finish: (installed: boolean) => finish?.(installed),
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop updates', () => {
  it('does nothing on the web', async () => {
    expect(desktopUpdates.supported).toBe(false)
    await desktopUpdates.check()
    expect(desktopUpdates.phase).toBe('idle')
    expect(desktopUpdates.prompt).toBe(false)
  })

  it('says so when the build cannot update itself, and never checks', async () => {
    const { updater } = fakeUpdater({ configured: vi.fn(() => Promise.resolve(false)) })
    const updates = createDesktopUpdates(updater)
    await updates.init()
    expect(updates.phase).toBe('unconfigured')
    await updates.check()
    expect(updater.check).not.toHaveBeenCalled()
    expect(updater.configured).toHaveBeenCalledTimes(1)
  })

  it('checks, and offers the update it found', async () => {
    const { updater } = fakeUpdater()
    const updates = createDesktopUpdates(updater)
    const checking = updates.check()
    await tick()
    expect(updates.phase).toBe('available')
    await checking
    expect(updates.info).toEqual(UPDATE)
    expect(updates.prompt).toBe(true)
  })

  it('finds none, or does not check while offline', async () => {
    const { updater } = fakeUpdater({ check: vi.fn(() => Promise.resolve(null)) })
    let online = true
    const updates = createDesktopUpdates(updater, { online: () => online })
    await updates.check()
    expect(updates.phase).toBe('none')
    expect(updates.prompt).toBe(false)
    online = false
    await updates.check()
    expect(updates.phase).toBe('offline')
    expect(updater.check).toHaveBeenCalledTimes(1)
  })

  it('says when a check got no answer, apart from finding none, and tries again later', async () => {
    const { updater } = fakeUpdater({ check: vi.fn(() => Promise.resolve<UpdateCheck>('failed')) })
    const updates = createDesktopUpdates(updater)
    await updates.check()
    expect(updates.phase).toBe('check-failed')
    expect(updates.info).toBeNull()
    expect(updates.prompt).toBe(false)
    vi.mocked(updater.check).mockResolvedValueOnce(UPDATE)
    await updates.check()
    expect(updates.phase).toBe('available')
  })

  it('installs with progress, then restarts', async () => {
    const fake = fakeUpdater()
    const updates = createDesktopUpdates(fake.updater)
    await updates.check()
    const installing = updates.install()
    expect(updates.phase).toBe('downloading')
    expect(updates.progress).toBeNull()
    fake.progress({ downloaded: 250, total: 1000 })
    expect(updates.progress).toBe(0.25)
    fake.progress({ downloaded: 1000, total: 1000 })
    expect(updates.phase).toBe('installing')
    fake.finish(true)
    await installing
    expect(updates.phase).toBe('restarting')
    expect(fake.updater.restart).toHaveBeenCalled()
    expect(updates.prompt).toBe(true)
  })

  it('reports a failed install, which Later puts off', async () => {
    const fake = fakeUpdater()
    const updates = createDesktopUpdates(fake.updater)
    await updates.check()
    const installing = updates.install()
    fake.progress({ downloaded: 10, total: null })
    expect(updates.progress).toBeNull()
    fake.finish(false)
    await installing
    expect(updates.phase).toBe('failed')
    expect(updates.prompt).toBe(true)
    expect(fake.updater.restart).not.toHaveBeenCalled()
    updates.later()
    expect(updates.phase).toBe('available')
    expect(updates.prompt).toBe(false)
  })

  it('waits for a newer version after Later', async () => {
    const { updater } = fakeUpdater()
    const updates = createDesktopUpdates(updater)
    await updates.check()
    updates.later()
    expect(updates.prompt).toBe(false)
    await updates.check()
    expect(updates.prompt).toBe(false)
    vi.mocked(updater.check).mockResolvedValueOnce({ ...UPDATE, version: '1.3.0' })
    await updates.check()
    expect(updates.prompt).toBe(true)
  })

  it('checks 10 s after launch and every 6 hours, not while one is on offer', async () => {
    vi.useFakeTimers()
    const { updater } = fakeUpdater({ check: vi.fn(() => Promise.resolve(null)) })
    const updates = createDesktopUpdates(updater)
    const stop = updates.schedule()
    await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_MS - 1)
    expect(updater.check).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(updater.check).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS)
    expect(updater.check).toHaveBeenCalledTimes(2)
    vi.mocked(updater.check).mockResolvedValue(UPDATE)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS)
    expect(updates.phase).toBe('available')
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS)
    expect(updater.check).toHaveBeenCalledTimes(3)
    stop()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_EVERY_MS * 3)
    expect(updater.check).toHaveBeenCalledTimes(3)
  })
})
