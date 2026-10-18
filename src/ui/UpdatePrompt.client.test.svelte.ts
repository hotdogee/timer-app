/**
 * The desktop update prompt and Settings › About's updates row over the real update state
 * (`createDesktopUpdates`) and a fake updater, in jsdom with Svelte's browser runtime.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UpdateCheck, UpdateInfo, UpdateProgress, Updater } from '../platform'
import { createDesktopUpdates } from '../pwa.svelte'

// The snackbar's motion reads `prefers-reduced-motion` as it loads, and jsdom has no matchMedia:
// stub it (reduced motion, so transitions take no time), then load the components.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList
}
// Nor the Web Animations API the snackbar's transition runs on: finish at once.
if (typeof Element.prototype.animate !== 'function') {
  Element.prototype.animate = function () {
    const animation = {
      onfinish: null as (() => void) | null,
      cancel: () => undefined,
      finished: Promise.resolve(),
    }
    queueMicrotask(() => animation.onfinish?.())
    return animation as unknown as Animation
  }
}
const { default: UpdatePrompt } = await import('./UpdatePrompt.svelte')
const { default: AboutSection } = await import('./settings/AboutSection.svelte')

const UPDATE: UpdateInfo = { version: '1.2.0', currentVersion: '1.1.0', notes: null, date: null }

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick()
    await Promise.resolve()
  }
  flushSync()
}

function fakeUpdater(configured = true) {
  let report: ((progress: UpdateProgress) => void) | undefined
  let finish: ((installed: boolean) => void) | undefined
  const updater = {
    supported: true,
    configured: vi.fn(() => Promise.resolve(configured)),
    check: vi.fn(() => Promise.resolve<UpdateCheck>(UPDATE)),
    install: vi.fn(
      (onProgress?: (progress: UpdateProgress) => void) =>
        new Promise<boolean>((resolve) => {
          report = onProgress
          finish = resolve
        }),
    ),
    restart: vi.fn(() => Promise.resolve()),
  } satisfies Updater
  return {
    updater,
    progress: (p: UpdateProgress) => report?.(p),
    finish: (installed: boolean) => finish?.(installed),
  }
}

function text(root: Element): string {
  return root.textContent.replace(/\s+/g, ' ').trim()
}

function button(root: ParentNode, label: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent.trim() === label,
  )
  if (found === undefined) throw new Error(`No button ${label}`)
  return found
}

/** Mounts what `make` mounts into a new element of the page; unmounts it after the test. */
function render(make: (target: HTMLElement) => Record<string, unknown>): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  const view = make(target)
  cleanups.push(() => {
    void unmount(view)
    target.remove()
  })
  return target
}

describe('UpdatePrompt', () => {
  it('offers a found update, shows the download and restarts', async () => {
    const fake = fakeUpdater()
    const updates = createDesktopUpdates(fake.updater)
    const blocked = $state({ value: true })
    const target = render((host) =>
      mount(UpdatePrompt, {
        target: host,
        props: {
          updates,
          get blocked() {
            return blocked.value
          },
        },
      }),
    )
    await updates.check()
    await settle()
    // Waits while another snackbar or a dialog shows.
    expect(target.querySelector('.snackbar')).toBeNull()
    blocked.value = false
    await settle()
    expect(text(target)).toContain('Update 1.2.0 available')
    button(target, 'Install and restart').click()
    await settle()
    expect(text(target)).toContain('Downloading the update…')
    fake.progress({ downloaded: 45, total: 100 })
    await settle()
    expect(text(target)).toContain('Downloading the update (45%)…')
    fake.finish(true)
    await settle()
    expect(text(target)).toContain('Restarting…')
    expect(fake.updater.restart).toHaveBeenCalled()
  })

  it('goes away on Later, and says when installing failed', async () => {
    const fake = fakeUpdater()
    const updates = createDesktopUpdates(fake.updater)
    const onleave = vi.fn()
    const target = render((host) =>
      mount(UpdatePrompt, { target: host, props: { updates, onleave } }),
    )
    await updates.check()
    await settle()
    const install = button(target, 'Install and restart')
    install.focus()
    // The app hears of it while the focus is still on the button that goes away.
    onleave.mockImplementationOnce(() => {
      expect(document.activeElement).toBe(install)
    })
    install.click()
    await settle()
    expect(onleave).toHaveBeenCalledTimes(1)
    fake.finish(false)
    await settle()
    expect(text(target)).toContain("Couldn't install the update.")
    button(target, 'Later').click()
    await settle()
    expect(onleave).toHaveBeenCalledTimes(2)
    expect(target.querySelector('.snackbar')).toBeNull()
    expect(updates.phase).toBe('available')
  })

  it('shows nothing without an update', async () => {
    const fake = fakeUpdater()
    fake.updater.check.mockResolvedValue(null)
    const updates = createDesktopUpdates(fake.updater)
    const target = render((host) => mount(UpdatePrompt, { target: host, props: { updates } }))
    await updates.check()
    await settle()
    expect(target.querySelector('.snackbar')).toBeNull()
  })
})

describe('About › Updates', () => {
  it('checks on request and offers the update', async () => {
    const fake = fakeUpdater()
    const updates = createDesktopUpdates(fake.updater)
    const target = render((host) =>
      mount(AboutSection, {
        target: host,
        props: { version: '1.1.0', platformKind: 'tauri', updates },
      }),
    )
    await settle()
    expect(text(target)).toContain('Updates')
    button(target, 'Check for updates').click()
    await settle()
    expect(fake.updater.check).toHaveBeenCalled()
    expect(target.querySelector('.updates [role="status"]')?.textContent.trim()).toBe(
      'Update 1.2.0 available',
    )
    button(target, 'Install and restart').click()
    await settle()
    expect(fake.updater.install).toHaveBeenCalled()
  })

  it('keeps its button, and the focus, while a check runs', async () => {
    const fake = fakeUpdater()
    let answer: (found: UpdateCheck) => void = () => undefined
    fake.updater.check.mockImplementation(
      () =>
        new Promise<UpdateCheck>((resolve) => {
          answer = resolve
        }),
    )
    const updates = createDesktopUpdates(fake.updater)
    const target = render((host) =>
      mount(AboutSection, {
        target: host,
        props: { version: '1.1.0', platformKind: 'tauri', updates },
      }),
    )
    await settle()
    const check = button(target, 'Check for updates')
    check.focus()
    check.click()
    await settle()
    expect(updates.phase).toBe('checking')
    expect(document.activeElement).toBe(check)
    expect(check.getAttribute('aria-disabled')).toBe('true')
    // Unavailable while busy: another press does nothing.
    check.click()
    await settle()
    expect(fake.updater.check).toHaveBeenCalledTimes(1)
    answer(null)
    await settle()
    expect(target.querySelector('.updates [role="status"]')?.textContent.trim()).toBe(
      'No updates found',
    )
    expect(document.activeElement).toBe(check)
    expect(check.hasAttribute('aria-disabled')).toBe(false)
  })

  it('says when a check got no answer, and offers to check again', async () => {
    const fake = fakeUpdater()
    fake.updater.check.mockResolvedValueOnce('failed')
    const updates = createDesktopUpdates(fake.updater)
    const target = render((host) =>
      mount(AboutSection, {
        target: host,
        props: { version: '1.1.0', platformKind: 'tauri', updates },
      }),
    )
    await settle()
    button(target, 'Check for updates').click()
    await settle()
    expect(updates.phase).toBe('check-failed')
    expect(target.querySelector('.updates [role="status"]')?.textContent.trim()).toBe(
      "Couldn't check for updates.",
    )
    button(target, 'Check again').click()
    await settle()
    expect(fake.updater.check).toHaveBeenCalledTimes(2)
    expect(target.querySelector('.updates [role="status"]')?.textContent.trim()).toBe(
      'Update 1.2.0 available',
    )
  })

  it('says when the build cannot update itself, at once', async () => {
    const updates = createDesktopUpdates(fakeUpdater(false).updater)
    const target = render((host) =>
      mount(AboutSection, {
        target: host,
        props: { version: '1.1.0', platformKind: 'tauri', updates },
      }),
    )
    await settle()
    expect(text(target)).toContain("Updates aren't set up in this build")
    expect([...target.querySelectorAll('button')].map((b) => b.textContent.trim())).not.toContain(
      'Check for updates',
    )
  })

  it('has no updates row on the web', async () => {
    const updates = createDesktopUpdates(fakeUpdater().updater)
    const target = render((host) =>
      mount(AboutSection, {
        target: host,
        props: { version: '1.1.0', platformKind: 'web', updates },
      }),
    )
    await settle()
    expect(target.querySelector('.updates')).toBeNull()
  })
})
