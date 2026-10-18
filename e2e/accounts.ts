/**
 * Accounts in the end-to-end tests. The sync server runs in development mode without a mailer
 * (e2e/sync-server.ts), so a sign-in code is not emailed: the server keeps the last code per
 * address for `GET /__dev/otp?email=`, which these helpers read. Every test signs in with an
 * address of its own (`newEmail`), so tests never share an account.
 */
import type { Locator, Page, TestInfo } from '@playwright/test'

import { closeSettings, expect, openSettings } from './support'

/** The JSON body of `/__dev/otp`. */
interface DevOtp {
  otp: string
}

/** Addresses handed out by this worker process so far. */
let emails = 0

/** An address no account has yet: unique per test, worker and run. */
export function newEmail(testInfo: TestInfo, name = 'user'): string {
  const unique = `${String(testInfo.workerIndex)}-${String(emails++)}-${Date.now().toString(36)}`
  return `${name}-${unique}@example.com`
}

/**
 * The sign-in code the server last made for `email`, waiting for it to exist (the server sends,
 * and so records, the code in the background). Pass the previous code as `not` to wait for a new
 * one.
 */
export async function devCode(page: Page, email: string, not?: string): Promise<string> {
  let otp = ''
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/__dev/otp?email=${encodeURIComponent(email)}`)
        if (!response.ok()) return false
        otp = ((await response.json()) as DevOtp).otp
        return otp !== not
      },
      { message: `the server made a sign-in code for ${email}` },
    )
    .toBe(true)
  return otp
}

/** The Account section of the settings dialog, opened. */
export function openAccount(page: Page): Promise<Locator> {
  return openSettings(page, 'Account')
}

/**
 * Signs in through Settings › Account with an emailed code, as a person would, and leaves the
 * dialog open on the signed-in account. The app must be open.
 */
export async function signIn(page: Page, email: string): Promise<Locator> {
  const dialog = await openAccount(page)
  await dialog.getByRole('textbox', { name: 'Email' }).fill(email)
  await dialog.getByRole('button', { name: 'Send code' }).click()
  const code = dialog.getByRole('textbox', { name: 'Code', exact: true })
  await expect(code).toBeFocused()
  // A whole code signs in by itself.
  await code.fill(await devCode(page, email))
  await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible()
  return dialog
}

/**
 * Signs in on the server directly (the same requests the app makes), then reloads, so the app
 * starts signed in. Quicker than {@link signIn} where the form is not what a test is about.
 */
export async function signInQuickly(page: Page, email: string): Promise<void> {
  // Better Auth refuses cookie-carrying requests from untrusted origins: send the app's.
  const headers = { Origin: new URL(page.url()).origin }
  const sent = await page.request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email, type: 'sign-in' },
    headers,
  })
  expect(sent.ok(), 'the code was sent').toBe(true)
  const signedIn = await page.request.post('/api/auth/sign-in/email-otp', {
    data: { email, otp: await devCode(page, email) },
    headers,
  })
  expect(signedIn.ok(), 'the code signed in').toBe(true)
  await page.reload()
  await expect(page.getByRole('main')).toBeAttached()
}

/** The action bar's sync status button, shown while signed in. */
export function syncButton(page: Page): Locator {
  return page.getByRole('button', { name: /^Account: / })
}

/** Waits until the app is connected to the sync server (the cloud says "Synced"). */
export async function expectOnline(page: Page): Promise<void> {
  await expect(syncButton(page)).toHaveAttribute('data-sync-status', 'online')
}

/** Signs in through the form, closes Settings and waits for the sync connection. */
export async function signInAndSync(page: Page, email: string): Promise<void> {
  await signIn(page, email)
  await closeSettings(page)
  await expectOnline(page)
}
