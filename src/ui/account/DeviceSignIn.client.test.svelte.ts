/**
 * The desktop sign-in through the browser, against the fake auth state: alone (the code, opening
 * the browser, copying, cancel, refusal, expiry, a failed start, focus) and in Settings › Account
 * on desktop (no provider buttons, the emailed code below, focus and an announcement once the code
 * is approved).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setAppLocale } from '../../i18n'
import { currentAnnouncement } from '../announce.svelte'
import AccountSection from '../settings/AccountSection.svelte'
import DeviceSignIn from './DeviceSignIn.svelte'
import { DEVICE_CODE, createFakeAuth } from './fake-auth.svelte'
import { formatUserCode, spellUserCode } from './device'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  setAppLocale('en')
})

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick()
    await Promise.resolve()
  }
  flushSync()
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

function hasButton(root: ParentNode, label: string): boolean {
  return [...root.querySelectorAll('button')].some((b) => b.textContent.trim() === label)
}

async function setup(copied = true, opened = true) {
  const fake = createFakeAuth({ providers: ['google'] })
  const openUrl = vi.fn((url: string) => {
    void url
    return Promise.resolve(opened)
  })
  const copyText = vi.fn(() => Promise.resolve(copied))
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(DeviceSignIn, { target, props: { auth: fake.auth, openUrl, copyText } })
  cleanups.push(() => {
    void unmount(view)
    target.remove()
  })
  await settle()
  return { ...fake, openUrl, copyText, target }
}

describe('the code helpers', () => {
  it('groups and spells the code', () => {
    expect(formatUserCode('wdjbmjht')).toBe('WDJB-MJHT')
    expect(formatUserCode('ABC')).toBe('ABC')
    expect(spellUserCode('WDJBMJHT')).toBe('W D J B, M J H T')
  })
})

describe('DeviceSignIn', () => {
  it('starts with the browser sign-in and what it does', async () => {
    const { target } = await setup()
    expect(text(target)).toContain('Sign in with your browser')
    expect(text(target)).toContain("You'll sign in on the website and approve this device there.")
  })

  it('shows the code, opens the browser on the approval page and copies the code', async () => {
    const { target, openUrl, copyText, startDeviceSignIn } = await setup()
    button(target, 'Sign in with your browser').click()
    await settle()
    expect(startDeviceSignIn).toHaveBeenCalled()
    expect(target.querySelector('[data-testid="device-user-code"]')?.textContent).toContain(
      'WDJB-MJHT',
    )
    expect(text(target)).toContain('Sign-in code W D J B, M J H T')
    expect(text(target)).toContain('Waiting for approval…')
    expect(text(target)).toMatch(/The code expires at \d/)
    const open = button(target, 'Open the browser')
    expect(document.activeElement).toBe(open)
    // Focusing it reads out the steps and the code.
    const described = (open.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent.replace(/\s+/g, ' ').trim())
    expect(described).toEqual([
      'Open the browser, sign in and approve this device. The page shows this code:',
      'Sign-in code W D J B, M J H T',
    ])
    // The page's address shows too, for another device or a browser that did not open.
    expect(text(target)).toContain('Or go to this address and enter the code:')
    expect(target.querySelector('[data-testid="device-address"]')?.textContent).toBe(
      'http://localhost:5173/device',
    )
    open.click()
    expect(openUrl).toHaveBeenCalledWith(`http://localhost:5173/device?user_code=${DEVICE_CODE}`)
    await settle()
    expect(target.querySelector('.waiting [role="alert"]')?.textContent).toBe('')
    button(target, 'Copy code').click()
    await settle()
    expect(copyText).toHaveBeenCalledWith('WDJB-MJHT')
    expect(text(target)).toContain('Code copied')
  })

  it('says when the browser did not open, pointing to the address', async () => {
    const { target, openUrl } = await setup(true, false)
    button(target, 'Sign in with your browser').click()
    await settle()
    button(target, 'Open the browser').click()
    await settle()
    expect(openUrl).toHaveBeenCalledTimes(1)
    expect(target.querySelector('.waiting [role="alert"]')?.textContent).toBe(
      "Couldn't open the browser. Go to the address above and enter the code there.",
    )
    // Still waiting: the code can be approved from anywhere.
    expect(text(target)).toContain('Waiting for approval…')
  })

  it('says when copying failed', async () => {
    const { target } = await setup(false)
    button(target, 'Sign in with your browser').click()
    await settle()
    button(target, 'Copy code').click()
    await settle()
    expect(text(target)).toContain("Couldn't copy the code.")
  })

  it('says so while the server is out of reach', async () => {
    const { target, state } = await setup()
    button(target, 'Sign in with your browser').click()
    await settle()
    if (state.device?.phase === 'waiting') state.device = { ...state.device, retrying: true }
    await settle()
    expect(text(target)).toContain("Can't reach the server. Still trying…")
  })

  it('goes back on Cancel, with focus on the start', async () => {
    const { target, cancelDeviceSignIn } = await setup()
    button(target, 'Sign in with your browser').click()
    await settle()
    button(target, 'Cancel').click()
    await settle()
    expect(cancelDeviceSignIn).toHaveBeenCalled()
    expect(document.activeElement).toBe(button(target, 'Sign in with your browser'))
  })

  it('offers a new code after a refusal or an expired code', async () => {
    const { target, deny, expire, startDeviceSignIn } = await setup()
    button(target, 'Sign in with your browser').click()
    await settle()
    deny()
    await settle()
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      'Signing in was denied in the browser.',
    )
    expect(document.activeElement).toBe(button(target, 'Get a new code'))
    button(target, 'Get a new code').click()
    await settle()
    expect(startDeviceSignIn).toHaveBeenCalledTimes(2)
    expire()
    await settle()
    expect(text(target)).toContain('The code expired before it was approved.')
  })

  it('reports a code it could not get', async () => {
    const { target, next } = await setup()
    next.error = 'rate-limited'
    button(target, 'Sign in with your browser').click()
    await settle()
    expect(target.querySelector('[role="alert"]')?.textContent).toBe(
      'Too many tries. Wait a minute and try again.',
    )
    expect(document.activeElement).toBe(button(target, 'Sign in with your browser'))
  })
})

describe('Settings › Account on desktop', () => {
  async function account() {
    const fake = createFakeAuth({ providers: ['google', 'github'] })
    const target = document.createElement('div')
    document.body.append(target)
    const view = mount(AccountSection, {
      target,
      props: { auth: fake.auth, sync: null, desktop: true, now: () => 0 },
    })
    cleanups.push(() => {
      void unmount(view)
      target.remove()
    })
    await settle()
    return { ...fake, target }
  }

  it('signs in through the browser or with an emailed code, without provider buttons', async () => {
    const { target } = await account()
    expect(hasButton(target, 'Sign in with your browser')).toBe(true)
    expect(text(target)).toContain('or sign in with an emailed code')
    expect(hasButton(target, 'Send code')).toBe(true)
    expect(hasButton(target, 'Continue with Google')).toBe(false)
  })

  it('hides the emailed code while the browser sign-in waits', async () => {
    const { target } = await account()
    button(target, 'Sign in with your browser').click()
    await settle()
    expect(hasButton(target, 'Send code')).toBe(false)
  })

  it('moves focus to the account and announces it once the code is approved', async () => {
    const { target, approve } = await account()
    button(target, 'Sign in with your browser').click()
    await settle()
    approve('grace@example.com')
    await settle()
    expect(text(target)).toContain('Signed in as grace@example.com')
    expect(document.activeElement?.classList.contains('profile')).toBe(true)
    expect(currentAnnouncement()).toBe('Signed in as grace@example.com')
  })
})
