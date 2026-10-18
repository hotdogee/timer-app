/**
 * The device approval page against a fake auth state and a fake approval API, in jsdom with
 * Svelte's browser runtime: the code from the link, sign-in first, approve and deny with their
 * results and focus, and the ways it fails.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setAppLocale } from '../../i18n'
import { currentAnnouncement } from '../announce.svelte'
import DeviceApproval from './DeviceApproval.svelte'
import { GOOD_CODE, createFakeAuth, type FakeAuthOptions } from './fake-auth.svelte'
import type { DeviceApprovalApi } from './types'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  setAppLocale('en')
})

const SIGNED_IN: FakeAuthOptions = {
  status: 'signed-in',
  user: { id: 'u1', email: 'ada@example.com', name: null, image: null },
}

async function setup(
  options: FakeAuthOptions = SIGNED_IN,
  { userCode = 'abcd-efgh', fail }: { userCode?: string; fail?: unknown } = {},
) {
  const fake = createFakeAuth(options)
  // The client rejects with the server's error body; here it rides on an Error.
  const reason = fail === undefined ? undefined : Object.assign(new Error('device'), fail)
  const answer = () => (reason === undefined ? Promise.resolve() : Promise.reject(reason))
  const device = {
    approve: vi.fn<DeviceApprovalApi['approve']>(answer),
    deny: vi.fn<DeviceApprovalApi['deny']>(answer),
  }
  const target = document.createElement('div')
  document.body.append(target)
  const page = mount(DeviceApproval, {
    target,
    props: { auth: fake.auth, device, userCode, homeHref: '/' },
  })
  cleanups.push(() => {
    void unmount(page)
    target.remove()
  })
  await settle()
  return { ...fake, device, target }
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick()
    await Promise.resolve()
  }
  flushSync()
}

function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (element === null) throw new Error(`No element matches ${selector}`)
  return element
}

function labelled(root: ParentNode, text: string): HTMLInputElement {
  const label = [...root.querySelectorAll('label')].find((l) => l.textContent.trim() === text)
  const control = label === undefined ? null : document.getElementById(label.htmlFor)
  if (control === null) throw new Error(`No control labelled ${text}`)
  return control as HTMLInputElement
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent.trim() === text,
  )
  if (found === undefined) throw new Error(`No button ${text}`)
  return found
}

function type(element: HTMLInputElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function text(root: Element): string {
  return root.textContent.replace(/\s+/g, ' ').trim()
}

describe('the device page', () => {
  it('shows the code from the link, tidied, in a page of its own', async () => {
    const { target } = await setup()
    expect(query(target, 'main h1').textContent).toBe('Approve a device')
    expect(labelled(target, 'Device code').value).toBe('ABCD-EFGH')
    expect(text(target)).toContain('Signed in as ada@example.com')
    expect(query<HTMLAnchorElement>(target, 'a').textContent.trim()).toBe('Back to Timer App')
  })

  it('asks a visitor who is signed out to sign in first, then offers the decision', async () => {
    const { target, device } = await setup({ status: 'signed-out' })
    expect(text(target)).toContain('Sign in to approve this device.')
    expect(target.querySelector('section h2')?.textContent).toBe('Sign in to approve this device.')
    expect(() => button(target, 'Approve this device')).toThrow()
    const email = labelled(target, 'Email')
    type(email, 'ada@example.com')
    email.closest('form')?.dispatchEvent(new SubmitEvent('submit', { cancelable: true }))
    await settle()
    type(labelled(target, 'Code'), GOOD_CODE)
    await settle()
    const approve = button(target, 'Approve this device')
    expect(document.activeElement).toBe(approve)
    expect(device.approve).not.toHaveBeenCalled()
  })

  it('says it is checking while the session is unknown', async () => {
    const { target } = await setup({ status: 'unknown' })
    expect(query(target, '[role="status"]').textContent).toBe('Checking your account…')
  })

  it('approves the code and ends on the result, with focus on it', async () => {
    const { target, device } = await setup()
    button(target, 'Approve this device').click()
    await settle()
    expect(device.approve).toHaveBeenCalledWith('ABCD-EFGH')
    const heading = query(target, 'h1')
    expect(heading.textContent.trim()).toBe('Device approved')
    expect(document.activeElement).toBe(heading)
    expect(text(target)).toContain('Go back to your device. It finishes signing in by itself.')
    expect(target.querySelector('input')).toBeNull()
  })

  it('denies the code, as edited, and says so', async () => {
    const { target, device } = await setup()
    type(labelled(target, 'Device code'), 'wxyz 2345')
    button(target, 'Deny').click()
    await settle()
    expect(device.deny).toHaveBeenCalledWith('WXYZ2345')
    expect(query(target, 'h1').textContent.trim()).toBe('Request denied')
    expect(text(target)).toContain('The device was not signed in.')
  })

  it('asks for a code when the field is empty', async () => {
    const { target, device } = await setup(SIGNED_IN, { userCode: '' })
    button(target, 'Approve this device').click()
    await settle()
    expect(device.approve).not.toHaveBeenCalled()
    const field = labelled(target, 'Device code')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(text(target)).toContain('Enter the code shown on your device.')
    expect(document.activeElement).toBe(field)
  })

  it('shows a problem with the code under the field', async () => {
    const { target } = await setup(SIGNED_IN, {
      fail: { error: 'expired_token', error_description: 'User code has expired', status: 400 },
    })
    button(target, 'Approve this device').click()
    await settle()
    const field = labelled(target, 'Device code')
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(text(target)).toContain('That code has expired. Start signing in on your device again.')
    expect(query(target, 'h1').textContent).toBe('Approve a device')
  })

  it('shows other problems under the buttons', async () => {
    const { target } = await setup(SIGNED_IN, { fail: { error: 'access_denied', status: 403 } })
    button(target, 'Approve this device').click()
    await settle()
    expect(query(target, '[role="alert"]').textContent).toBe(
      'This request belongs to another account.',
    )
    expect(labelled(target, 'Device code').getAttribute('aria-invalid')).toBeNull()
  })

  it('signs out for another account, says so and puts focus in the email field', async () => {
    const { target, signOut } = await setup()
    const other = button(target, 'Use another account')
    other.focus()
    other.click()
    await settle()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(text(target)).toContain('Sign in to approve this device.')
    expect(document.activeElement).toBe(labelled(target, 'Email'))
    expect(currentAnnouncement()).toBe('Signed out. Your cards stay on this device.')
  })

  it('links the privacy policy where a visitor can create an account', async () => {
    const { target } = await setup({ status: 'signed-out' })
    const link = query<HTMLAnchorElement>(target, '.sign-in a[target="_blank"]')
    expect(link.textContent.trim()).toBe('How your data is handled')
    expect(link.rel).toBe('noopener noreferrer')
  })

  it('speaks the active language', async () => {
    setAppLocale('ja')
    const { target } = await setup()
    expect(query(target, 'h1').textContent).toBe('デバイスのログインを承認')
    expect(button(target, 'このデバイスを承認')).toBeTruthy()
  })
})
