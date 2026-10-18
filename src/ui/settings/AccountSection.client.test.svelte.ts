/**
 * Settings › Account against a fake auth state (`account/fake-auth.svelte.ts`), in jsdom with
 * Svelte's browser runtime: the email-code sign-in in both steps with its errors and focus, the
 * provider buttons, the signed-in summary with each sync status, the server copy, signing out and
 * deleting the account behind its typed confirmation.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { setAppLocale } from '../../i18n'
import { CHECKING_PATIENCE_MS } from '../account/checking.svelte'
import { createSyncPreference, type SyncPreference } from '../../state/sync-preference.svelte'
import { GOOD_CODE, createFakeAuth, type FakeAuthOptions } from '../account/fake-auth.svelte'
import { ServerCopyError } from '../account/server-copy'
import type { SyncInfo } from '../account/types'
import { currentAnnouncement } from '../announce.svelte'
import AccountSection from './AccountSection.svelte'

beforeAll(() => {
  // jsdom has <dialog> and its `open` attribute, but not the modal API.
  const dialog = HTMLDialogElement.prototype as Partial<HTMLDialogElement>
  if (typeof dialog.showModal !== 'function') {
    dialog.showModal = function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    }
  }
  if (typeof dialog.close !== 'function') {
    dialog.close = function (this: HTMLDialogElement) {
      if (!this.hasAttribute('open')) return
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  }
})

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  setAppLocale('en')
})

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0)
const SIGNED_IN: FakeAuthOptions = {
  status: 'signed-in',
  user: { id: 'u1', email: 'ada@example.com', name: 'Ada Lovelace', image: null },
}

async function setup(
  options: FakeAuthOptions = {},
  extra: {
    sync?: SyncInfo | null
    download?: () => Promise<string>
    syncPreference?: SyncPreference | null
  } = {},
) {
  const fake = createFakeAuth(options)
  const sync = $state<{ value: SyncInfo | null }>({
    value: extra.sync === undefined ? { status: 'online', lastSyncAt: NOW } : extra.sync,
  })
  const download = vi.fn(extra.download ?? (() => Promise.resolve('timer-app-server.json')))
  const target = document.createElement('div')
  document.body.append(target)
  const section = mount(AccountSection, {
    target,
    props: {
      auth: fake.auth,
      get sync() {
        return sync.value
      },
      now: () => NOW,
      downloadServerCopy: download,
      syncPreference: extra.syncPreference ?? null,
    },
  })
  cleanups.push(() => {
    void unmount(section)
    target.remove()
  })
  await settle()
  return { ...fake, sync, download, target }
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

/** The control a visible `<label>` with exactly this text names. */
function labelled<T extends HTMLElement = HTMLInputElement>(root: ParentNode, text: string): T {
  const label = [...root.querySelectorAll('label')].find((l) => l.textContent.trim() === text)
  const control = label === undefined ? null : document.getElementById(label.htmlFor)
  if (control === null) throw new Error(`No control labelled ${text}`)
  return control as T
}

/** The visible text of every button, leaving out those of a closed dialog. */
function buttons(root: ParentNode): string[] {
  return [...root.querySelectorAll('button')]
    .filter((b) => b.closest('dialog:not([open])') === null)
    .map((b) => b.textContent.trim())
}

function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent.trim() === text,
  )
  if (found === undefined) throw new Error(`No button ${text}; have ${buttons(root).join(', ')}`)
  return found
}

function type(element: HTMLInputElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

function submit(element: HTMLElement) {
  const form = element.closest('form')
  if (form === null) throw new Error('Not in a form')
  form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
  flushSync()
}

function text(root: Element): string {
  return root.textContent.replace(/\s+/g, ' ').trim()
}

describe('signed out', () => {
  it('offers sign-in to sync, with the providers the server has', async () => {
    const { target } = await setup({ providers: ['google', 'github'] })
    expect(text(target)).toContain('Sign in to sync your cards across devices')
    expect(text(target)).toContain('Without an account, everything stays on this device.')
    const email = labelled(target, 'Email')
    expect(email.type).toBe('email')
    expect(email.autocomplete).toBe('email')
    expect(buttons(target)).toEqual(['Send code', 'Continue with Google', 'Continue with GitHub'])
    expect(text(target)).toContain('or')
    const privacy = query<HTMLAnchorElement>(target, 'a')
    expect(privacy.textContent.trim()).toBe('How your data is handled')
    expect(privacy.href).toContain('docs/privacy.md')
  })

  it('shows no provider buttons and no divider when none is configured', async () => {
    const { target } = await setup()
    expect(buttons(target)).toEqual(['Send code'])
    expect(target.querySelector('.divider')).toBeNull()
  })

  it('says it is checking while the session is unknown', async () => {
    const { target, state } = await setup({ status: 'unknown' })
    expect(query(target, '[role="status"]').textContent).toBe('Checking your account…')
    state.status = 'signed-out'
    await settle()
    expect(labelled(target, 'Email')).toBeTruthy()
  })

  it('offers sign-in anyway when the check does not answer (server out of reach)', async () => {
    vi.useFakeTimers()
    try {
      const { target } = await setup({ status: 'unknown' })
      expect(target.querySelector('input')).toBeNull()
      vi.advanceTimersByTime(CHECKING_PATIENCE_MS - 1)
      await settle()
      expect(target.querySelector('input')).toBeNull()
      vi.advanceTimersByTime(1)
      await settle()
      expect(labelled(target, 'Email')).toBeTruthy()
      expect(target.textContent).not.toContain('Checking your account…')
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses an address that is not one, without asking the server', async () => {
    const { target, sendCode } = await setup()
    const email = labelled(target, 'Email')
    type(email, 'not-an-address')
    submit(email)
    await settle()
    expect(sendCode).not.toHaveBeenCalled()
    expect(email.getAttribute('aria-invalid')).toBe('true')
    expect(text(target)).toContain('Enter a valid email address.')
    expect(document.activeElement).toBe(email)
    type(email, 'ada@example.com')
    expect(email.getAttribute('aria-invalid')).toBeNull()
  })

  it('sends the code, then asks for it with focus in the code field', async () => {
    const { target, sendCode } = await setup()
    const email = labelled(target, 'Email')
    type(email, ' ada@example.com ')
    submit(email)
    await settle()
    expect(sendCode).toHaveBeenCalledWith('ada@example.com')
    expect(text(target)).toContain(
      'We sent a 6-digit code to ada@example.com. It expires in 10 minutes.',
    )
    const code = labelled(target, 'Code')
    expect(code.inputMode).toBe('numeric')
    expect(code.autocomplete).toBe('one-time-code')
    expect(document.activeElement).toBe(code)
    expect(buttons(target)).toEqual(['Sign in', 'Use another email', 'Send a new code'])
  })

  it('says why the code could not be sent', async () => {
    const { target, next } = await setup()
    next.error = 'rate-limited'
    const email = labelled(target, 'Email')
    type(email, 'ada@example.com')
    submit(email)
    await settle()
    expect(text(target)).toContain('Too many tries. Wait a minute and try again.')
    expect(labelled(target, 'Email')).toBe(email)
  })

  async function atCodeStep(options: FakeAuthOptions = {}) {
    const setupResult = await setup(options)
    const email = labelled(setupResult.target, 'Email')
    type(email, 'ada@example.com')
    submit(email)
    await settle()
    return { ...setupResult, code: labelled(setupResult.target, 'Code') }
  }

  it('asks for six digits before trying, and keeps only digits', async () => {
    const { target, code, verifyCode } = await atCodeStep()
    type(code, '12a')
    await settle()
    expect(code.value).toBe('12')
    submit(code)
    await settle()
    expect(verifyCode).not.toHaveBeenCalled()
    expect(text(target)).toContain('Enter the 6-digit code from the email.')
  })

  it('says a wrong code is wrong, and signs in by itself once a whole code is typed', async () => {
    const { target, code, verifyCode } = await atCodeStep()
    type(code, '111 111')
    await settle()
    expect(verifyCode).toHaveBeenLastCalledWith('ada@example.com', '111111')
    expect(text(target)).toContain("That code isn't right. Check it and try again.")
    expect(document.activeElement).toBe(code)
    // The same wrong code is not sent again on every edit.
    type(code, '111111')
    await settle()
    expect(verifyCode).toHaveBeenCalledTimes(1)
    type(code, GOOD_CODE)
    await settle()
    expect(verifyCode).toHaveBeenLastCalledWith('ada@example.com', GOOD_CODE)
    expect(text(target)).toContain('Signed in as ada@example.com')
    expect(currentAnnouncement()).toBe('Signed in as ada@example.com')
    expect(document.activeElement).toBe(query(target, '.profile'))
  })

  it('tells expired codes and too many attempts apart', async () => {
    const expired = await atCodeStep()
    expired.next.error = 'expired-code'
    type(expired.code, GOOD_CODE)
    await settle()
    expect(text(expired.target)).toContain('That code has expired. Send a new one.')
    for (const cleanup of cleanups.splice(0).reverse()) cleanup()

    const locked = await atCodeStep()
    locked.next.error = 'too-many-attempts'
    type(locked.code, '000000')
    await settle()
    expect(text(locked.target)).toContain('Too many wrong codes. Send a new one.')
  })

  it('never calls a right code wrong once the code is spent, and points to a new one', async () => {
    const { target, code, next, verifyCode } = await atCodeStep()
    next.error = 'too-many-attempts'
    type(code, '000000')
    await settle()
    const newCode = button(target, 'Send a new code')
    expect(document.activeElement).toBe(newCode)
    // The right code now: no attempt, the same reason, focus on the way out.
    code.focus()
    type(code, GOOD_CODE)
    await settle()
    submit(code)
    await settle()
    expect(verifyCode).toHaveBeenCalledTimes(1)
    expect(text(target)).toContain('Too many wrong codes. Send a new one.')
    expect(text(target)).not.toContain("That code isn't right")
    expect(document.activeElement).toBe(newCode)
    // A new code makes the field work again.
    newCode.click()
    await settle()
    type(code, GOOD_CODE)
    await settle()
    expect(verifyCode).toHaveBeenCalledTimes(2)
    expect(button(target, 'Sign out')).toBeDefined()
  })

  it('describes the code field: where the code went, when it expires, that it signs in by itself', async () => {
    const { code } = await atCodeStep()
    const ids = (code.getAttribute('aria-describedby') ?? '').split(' ')
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
    expect(described).toBe(
      "We sent a 6-digit code to ada@example.com. It expires in 10 minutes. You're signed in as soon as all 6 digits are in.",
    )
  })

  it('joins its sentences without a space after 。 in Chinese', async () => {
    const { code } = await atCodeStep()
    setAppLocale('zh-TW')
    flushSync()
    const id = code.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(id)?.textContent).toBe(
      '我們已將 6 位數的驗證碼寄到 ada@example.com。驗證碼將在 10 分鐘後過期。輸入完 6 位數字就會自動登入。',
    )
    setAppLocale('en')
  })

  it('sends a new code on request and says so', async () => {
    const { target, code, sendCode } = await atCodeStep()
    button(target, 'Send a new code').click()
    await settle()
    expect(sendCode).toHaveBeenCalledTimes(2)
    expect(text(target)).toContain('We sent a new code.')
    expect(document.activeElement).toBe(code)
  })

  it('goes back to the email, kept and focused, for another address', async () => {
    const { target } = await atCodeStep()
    button(target, 'Use another email').click()
    await settle()
    const email = labelled(target, 'Email')
    expect(email.value).toBe('ada@example.com')
    expect(document.activeElement).toBe(email)
  })

  it('leaves for a provider, saying so on its button', async () => {
    const { target, signInWith, gate } = await setup({ providers: ['google'] })
    let open = () => undefined as void
    gate.wait = new Promise((resolve) => {
      open = resolve
    })
    button(target, 'Continue with Google').click()
    await settle()
    expect(signInWith).toHaveBeenCalledWith('google')
    expect(buttons(target)).toContain('Opening Google…')
    open()
    await settle()
    expect(buttons(target)).toContain('Opening Google…')
  })

  it('says why a provider sign-in could not start', async () => {
    const { target, next } = await setup({ providers: ['github'] })
    next.error = 'network'
    button(target, 'Continue with GitHub').click()
    await settle()
    expect(query(target, '[role="alert"]').textContent).toBe(
      "Can't reach the server. Check your connection and try again.",
    )
    expect(buttons(target)).toContain('Continue with GitHub')
  })

  it('shows a provider sign-in that failed at the provider, once back', async () => {
    const { target, state } = await setup({ providers: ['github'] })
    expect(query(target, '[role="alert"]').textContent).toBe('')
    state.error = 'oauth'
    await settle()
    expect(query(target, '[role="alert"]').textContent).toBe(
      "Signing in with that account didn't finish. Try again.",
    )
  })

  it('speaks the active language', async () => {
    setAppLocale('zh-TW')
    const { target } = await setup({ providers: ['apple'] })
    expect(text(target)).toContain('登入即可在各裝置間同步卡片')
    expect(buttons(target)).toEqual(['傳送驗證碼', '使用 Apple 繼續'])
    setAppLocale('ja')
    await settle()
    expect(buttons(target)).toEqual(['コードを送信', 'Apple で続ける'])
  })
})

describe('signed in', () => {
  it('shows who is signed in and the sync status', async () => {
    const { target } = await setup(SIGNED_IN)
    expect(text(query(target, '.who'))).toBe('Ada Lovelace Signed in as ada@example.com')
    expect(query(target, '.initial').textContent).toBe('A')
    expect(query(target, '.initial').getAttribute('aria-hidden')).toBe('true')
    expect(text(query(target, '.sync'))).toBe('Sync Synced just now')
    expect(buttons(target)).toEqual(['Download', 'Sign out', 'Delete…'])
  })

  it('shows the picture when there is one, without sending the page as referrer', async () => {
    const { target } = await setup({
      status: 'signed-in',
      user: { id: 'u1', email: 'ada@example.com', name: null, image: 'https://example.com/a.png' },
    })
    const image = query<HTMLImageElement>(target, 'img.avatar')
    expect(image.src).toBe('https://example.com/a.png')
    expect(image.alt).toBe('')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(text(query(target, '.who'))).toBe('Signed in as ada@example.com')
  })

  it('shows the initial instead of a picture that does not load', async () => {
    const { target } = await setup({
      status: 'signed-in',
      user: { id: 'u1', email: 'ada@example.com', name: null, image: 'https://example.com/a.png' },
    })
    query<HTMLImageElement>(target, 'img.avatar').dispatchEvent(new Event('error'))
    await settle()
    expect(target.querySelector('img.avatar')).toBeNull()
    expect(text(query(target, '.initial'))).toBe('A')
  })

  it('follows every sync status', async () => {
    const { target, sync } = await setup(SIGNED_IN)
    const line = () => text(query(target, '.sync'))
    sync.value = { status: 'online', lastSyncAt: NOW - 5 * 60_000 }
    await settle()
    expect(line()).toBe('Sync Synced 5 minutes ago')
    sync.value = { status: 'connecting', lastSyncAt: NOW - 5 * 60_000 }
    await settle()
    expect(line()).toBe('Sync Connecting… Last synced 5 minutes ago')
    sync.value = { status: 'offline', lastSyncAt: null }
    await settle()
    expect(line()).toBe("Sync Offline. Changes sync when you're back.")
    expect(query(target, '.sync').dataset.syncStatus).toBe('offline')
    sync.value = null
    await settle()
    expect(line()).toBe('Sync Not syncing')
  })

  it('downloads the server copy and says where it went', async () => {
    const { target, download } = await setup(SIGNED_IN)
    expect(labelled<HTMLButtonElement>(target, 'Download server copy').textContent.trim()).toBe(
      'Download',
    )
    button(target, 'Download').click()
    await settle()
    expect(download).toHaveBeenCalledTimes(1)
    expect(query(target, '[role="status"]').textContent).toBe('Saved timer-app-server.json')
  })

  it('says why the server copy could not be downloaded', async () => {
    const { target } = await setup(SIGNED_IN, {
      download: () => Promise.reject(new TypeError('Failed to fetch')),
    })
    button(target, 'Download').click()
    await settle()
    expect(query(target, '[role="alert"]').textContent).toBe(
      "Couldn't download the server copy. Can't reach the server. Check your connection and try again.",
    )
  })

  it('says the session ended when the server refuses the copy, and has it checked', async () => {
    const { target, refresh } = await setup(SIGNED_IN, {
      download: () => Promise.reject(new ServerCopyError(401, 'Unauthorized')),
    })
    button(target, 'Download').click()
    await settle()
    expect(query(target, '[role="alert"]').textContent).toBe(
      "Couldn't download the server copy. Your session has ended. Sign in again.",
    )
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('turns sync off and on for this device with a switch', async () => {
    const preference = createSyncPreference({ storage: null })
    const { target } = await setup(SIGNED_IN, { syncPreference: preference })
    const toggle = labelled<HTMLButtonElement>(target, 'Sync this device')
    expect(toggle.getAttribute('role')).toBe('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    toggle.click()
    flushSync()
    expect(preference.enabled).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.click()
    flushSync()
    expect(preference.enabled).toBe(true)
  })

  it('has no sync switch without a preference to show', async () => {
    const { target } = await setup(SIGNED_IN)
    expect(text(target)).not.toContain('Sync this device')
  })

  it('signs out, keeps the cards, and offers sign-in with focus in the email field', async () => {
    const { target, signOut } = await setup(SIGNED_IN)
    button(target, 'Sign out').click()
    await settle()
    expect(signOut).toHaveBeenCalledTimes(1)
    expect(currentAnnouncement()).toBe('Signed out. Your cards stay on this device.')
    expect(document.activeElement).toBe(labelled(target, 'Email'))
  })

  it('says when the desktop app signed out here only, the server out of reach', async () => {
    const { target, signOut, state } = await setup(SIGNED_IN)
    signOut.mockImplementationOnce(() => {
      state.user = null
      state.status = 'signed-out'
      return Promise.resolve('device-only' as const)
    })
    button(target, 'Sign out').click()
    await settle()
    expect(currentAnnouncement()).toBe(
      "Signed out on this device. The server couldn't be reached, so the session there ends when it expires.",
    )
  })

  it('says why signing out failed and stays signed in', async () => {
    const { target, next } = await setup(SIGNED_IN)
    next.error = 'network'
    button(target, 'Sign out').click()
    await settle()
    expect(query(target, '[role="alert"]').textContent).toBe(
      "Can't reach the server. Check your connection and try again.",
    )
    expect(buttons(target)).toContain('Sign out')
  })
})

describe('deleting the account', () => {
  async function openDelete() {
    const setupResult = await setup(SIGNED_IN)
    button(setupResult.target, 'Delete…').click()
    await settle()
    const dialog = query<HTMLDialogElement>(setupResult.target, 'dialog')
    return { ...setupResult, dialog }
  }

  it('says what is deleted and what stays, and wants DELETE typed', async () => {
    const { dialog, deleteAccount } = await openDelete()
    expect(dialog.open).toBe(true)
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')
    expect(title?.textContent).toBe('Delete your account?')
    const message = document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
    expect(message?.textContent).toContain('cards on this device stay')
    const confirm = button(dialog, 'Delete account')
    expect(confirm.disabled).toBe(true)
    const field = labelled(dialog, 'Type DELETE to confirm')
    type(field, 'delet')
    expect(confirm.disabled).toBe(true)
    submit(field)
    await settle()
    expect(deleteAccount).not.toHaveBeenCalled()
    type(field, 'delete')
    expect(confirm.disabled).toBe(false)
  })

  it('deletes, closes, and returns to signed out with the cards kept', async () => {
    const { target, dialog, deleteAccount } = await openDelete()
    type(labelled(dialog, 'Type DELETE to confirm'), 'DELETE')
    submit(button(dialog, 'Delete account'))
    await settle()
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(target.querySelector('dialog')).toBeNull()
    expect(currentAnnouncement()).toBe('Account deleted. Your cards stay on this device.')
    expect(document.activeElement).toBe(labelled(target, 'Email'))
  })

  it('keeps the dialog open with the reason when deleting fails', async () => {
    const { dialog, next } = await openDelete()
    next.error = 'session-expired'
    type(labelled(dialog, 'Type DELETE to confirm'), 'DELETE')
    submit(button(dialog, 'Delete account'))
    await settle()
    expect(dialog.open).toBe(true)
    expect(text(dialog)).toContain(
      "Couldn't delete your account. For your security, sign out and sign in again first.",
    )
  })

  it('cancels without deleting, and starts empty the next time', async () => {
    const { target, dialog, deleteAccount } = await openDelete()
    type(labelled(dialog, 'Type DELETE to confirm'), 'DELETE')
    button(dialog, 'Cancel').click()
    await settle()
    expect(dialog.open).toBe(false)
    expect(deleteAccount).not.toHaveBeenCalled()
    button(target, 'Delete…').click()
    await settle()
    expect(labelled(dialog, 'Type DELETE to confirm').value).toBe('')
  })
})
