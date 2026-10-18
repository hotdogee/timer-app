/**
 * The device approval page (`/device`), the web half of the desktop app's sign-in: the desktop app
 * asks the server for a code and opens this page with it; the person signs in here and approves
 * (or denies), and the app's polling then gets a session token (or a refusal). The desktop side
 * is played with the API requests it will make (`POST /api/auth/device/code`, `…/device/token`).
 */
import type { APIRequestContext } from '@playwright/test'

import { devCode, newEmail, signInQuickly } from './accounts'
import { announcer, cardCells, expect, openApp, test } from './support'

/** The desktop app's client id (`DESKTOP_CLIENT_ID` in src/sync/protocol.ts). */
const CLIENT_ID = 'timer-app-desktop'

interface DeviceCode {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

interface TokenAnswer {
  access_token?: string
  error?: string
}

/** What the desktop app does first: ask for a code to show and a page to open. */
async function requestDeviceCode(request: APIRequestContext): Promise<DeviceCode> {
  const response = await request.post('/api/auth/device/code', { data: { client_id: CLIENT_ID } })
  expect(response.ok(), 'the server hands out a device code').toBe(true)
  return (await response.json()) as DeviceCode
}

/** One poll of the desktop app for its token. */
async function pollToken(request: APIRequestContext, deviceCode: string): Promise<TokenAnswer> {
  const response = await request.post('/api/auth/device/token', {
    data: {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: CLIENT_ID,
    },
  })
  return (await response.json()) as TokenAnswer
}

/**
 * Polls like the desktop app until the answer is no longer "wait" (`authorization_pending`, or
 * `slow_down` when polled faster than the server's interval).
 */
async function finalAnswer(request: APIRequestContext, deviceCode: string): Promise<TokenAnswer> {
  let answer: TokenAnswer = {}
  await expect
    .poll(
      async () => {
        answer = await pollToken(request, deviceCode)
        return answer.error === 'authorization_pending' || answer.error === 'slow_down'
      },
      { intervals: [1_000], timeout: 15_000, message: 'the server decides the device request' },
    )
    .toBe(false)
  return answer
}

test('approving a device signs it in; the page itself syncs nothing', async ({
  page,
  request,
  baseURL,
}, testInfo) => {
  const code = await requestDeviceCode(request)
  expect(code.verification_uri).toBe(new URL('/device', baseURL).href)
  expect(code.verification_uri_complete).toBe(
    `${code.verification_uri}?user_code=${encodeURIComponent(code.user_code)}`,
  )
  expect(await pollToken(request, code.device_code)).toMatchObject({
    error: 'authorization_pending',
  })

  // The page the desktop app opens: the code, and sign-in first, under a title of its own.
  await page.goto(code.verification_uri_complete)
  await expect(page.getByRole('heading', { level: 1, name: 'Approve a device' })).toBeVisible()
  await expect(page).toHaveTitle('Approve a device – Timer App')
  await expect(page.getByRole('textbox', { name: 'Device code' })).toHaveValue(code.user_code)
  await expect(page.getByRole('heading', { name: 'Sign in to approve this device.' })).toBeVisible()
  // A page of its own: no cards.
  await expect(page.getByRole('grid', { name: 'Cards' })).toHaveCount(0)

  const email = newEmail(testInfo)
  await page.getByRole('textbox', { name: 'Email' }).fill(email)
  await page.getByRole('button', { name: 'Send code' }).click()
  await page.getByRole('textbox', { name: 'Code', exact: true }).fill(await devCode(page, email))
  await expect(announcer(page)).toHaveText(`Signed in as ${email}`)
  const approve = page.getByRole('button', { name: 'Approve this device' })
  await expect(approve).toBeFocused()
  await approve.click()
  const result = page.getByRole('heading', { level: 1, name: 'Device approved' })
  await expect(result).toBeFocused()

  // The desktop app's next poll gets a session token, good as a bearer token.
  const answer = await finalAnswer(request, code.device_code)
  expect(answer.access_token).toEqual(expect.any(String))
  const exported = await request.get('/api/export', {
    headers: { Authorization: `Bearer ${answer.access_token ?? ''}` },
  })
  expect(exported.status()).toBe(200)
  // The device page loads no cards, so signing in there uploaded none to the account.
  const copy = (await exported.json()) as { tables: { cards?: object } }
  expect(copy.tables.cards ?? {}).toEqual({})

  // Back to the app, which is signed in to the same account.
  await page.getByRole('link', { name: 'Back to Timer App' }).click()
  await expect(cardCells(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Account: Synced' })).toBeVisible()
})

test('denying a device refuses it; a signed-in visitor goes straight to the choice', async ({
  page,
  request,
}, testInfo) => {
  const email = newEmail(testInfo)
  await openApp(page)
  await signInQuickly(page, email)

  const code = await requestDeviceCode(request)
  await page.goto(code.verification_uri_complete)
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Email' })).toHaveCount(0)
  // The approval page itself cannot be framed (the production build's headers).
  if (process.env.E2E_SERVER === 'preview' || (process.env.CI && !process.env.E2E_SERVER)) {
    const response = await page.request.get('/device')
    expect(response.headers()['x-frame-options']).toBe('DENY')
    expect(response.headers()['content-security-policy']).toBe("frame-ancestors 'none'")
  }
  await page.getByRole('button', { name: 'Deny' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Request denied' })).toBeFocused()

  expect(await finalAnswer(request, code.device_code)).toMatchObject({ error: 'access_denied' })
})

test('a code the server does not know is refused under the field', async ({
  page,
  allowedErrors,
}, testInfo) => {
  // The server's refusal is an error status, which the browser logs.
  allowedErrors.push(/status of 4\d\d/)
  await openApp(page)
  await signInQuickly(page, newEmail(testInfo))

  await page.goto('/device?user_code=WXYZ-2345')
  const field = page.getByRole('textbox', { name: 'Device code' })
  await expect(field).toHaveValue('WXYZ-2345')
  await page.getByRole('button', { name: 'Approve this device' }).click()
  await expect(page.getByText("That code isn't valid. Check it and try again.")).toBeVisible()
  await expect(field).toBeFocused()
  await expect(page.getByRole('heading', { level: 1, name: 'Approve a device' })).toBeVisible()
})

test('"Use another account" signs out and puts focus in the sign-in form', async ({
  page,
}, testInfo) => {
  await openApp(page)
  await signInQuickly(page, newEmail(testInfo))
  await page.goto('/device?user_code=WXYZ-2345')
  const other = page.getByRole('button', { name: 'Use another account' })
  await other.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeFocused()
  await expect(announcer(page)).toHaveText('Signed out. Your cards stay on this device.')
  await expect(page.getByRole('link', { name: 'How your data is handled' })).toBeVisible()
})
