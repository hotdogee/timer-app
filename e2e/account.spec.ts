/**
 * Accounts (spec › Sync › Accounts are optional, Sign-in; Settings › Account) against the real sync
 * server: signing in with an emailed code, the signed-in account with its sync status in Settings
 * and in the action bar, signing out and deleting the account (both keep the cards on the device),
 * the server copy download, and the provider buttons, which show only for providers the server has
 * credentials for. The codes come from the server's development endpoint (see accounts.ts).
 */
import { readFile } from 'node:fs/promises'

import type { WebSocket } from '@playwright/test'

import {
  devCode,
  expectOnline,
  newEmail,
  openAccount,
  signIn,
  signInAndSync,
  signInQuickly,
  syncButton,
} from './accounts'
import {
  cardCells,
  cardNames,
  closeSettings,
  dialogAnnouncer,
  expect,
  openApp,
  reloadApp,
  test,
} from './support'

test('signs in with an emailed code and shows the account and its sync status', async ({
  page,
  allowedErrors,
}, testInfo) => {
  // The wrong code below is a 400 answer, which the browser logs.
  allowedErrors.push(/status of 400/)
  const email = newEmail(testInfo)
  await openApp(page)
  // Signed out: no cloud in the action bar.
  await expect(page.getByRole('group', { name: 'Card actions' })).toBeVisible()
  await expect(syncButton(page)).toHaveCount(0)

  const dialog = await openAccount(page)
  await expect(dialog.getByText('Sign in to sync your cards across devices')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Email' }).fill(email)
  await dialog.getByRole('button', { name: 'Send code' }).click()
  await expect(dialog.getByText(`We sent a 6-digit code to ${email}.`)).toBeVisible()
  const field = dialog.getByRole('textbox', { name: 'Code', exact: true })
  await expect(field).toBeFocused()
  await expect(field).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(field).toHaveAttribute('inputmode', 'numeric')

  // A wrong code is refused, with the reason under the field.
  const code = await devCode(page, email)
  const wrong = code === '000000' ? '111111' : '000000'
  await field.fill(wrong)
  await expect(dialog.getByText("That code isn't right. Check it and try again.")).toBeVisible()
  await expect(field).toBeFocused()

  // The right one signs in: the account, its sync status, and focus on the summary.
  await field.fill(code)
  await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect(dialog.locator('.profile')).toContainText(`Signed in as ${email}`)
  await expect(dialog.locator('.profile')).toBeFocused()
  await expect(dialogAnnouncer(page)).toHaveText(`Signed in as ${email}`)
  const status = dialog.locator('[data-sync-status]')
  await expect(status).toHaveAttribute('data-sync-status', 'online')
  await expect(status).toContainText('Synced just now')

  // The action bar's cloud says so too, and opens this section again.
  await closeSettings(page)
  await expect(syncButton(page)).toHaveAccessibleName('Account: Synced')
  await syncButton(page).click()
  await expect(dialog.getByRole('tab', { name: 'Account' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible()

  // A reload starts signed in and connects again.
  await reloadApp(page)
  await expectOnline(page)
})

test('signing out keeps the cards on the device and hides the cloud', async ({
  page,
}, testInfo) => {
  await openApp(page)
  await signInAndSync(page, newEmail(testInfo))
  await page.getByRole('button', { name: 'New stopwatch' }).click()
  await expect(cardCells(page)).toHaveCount(2)

  const dialog = await openAccount(page)
  await dialog.getByRole('button', { name: 'Sign out' }).click()
  // Back to the sign-in form, with focus in its email field.
  const emailField = dialog.getByRole('textbox', { name: 'Email' })
  await expect(emailField).toBeFocused()
  await expect(dialogAnnouncer(page)).toHaveText('Signed out. Your cards stay on this device.')
  await closeSettings(page)

  await expect(syncButton(page)).toHaveCount(0)
  expect(await cardNames(page)).toEqual(['Timer', 'Stopwatch'])
  // The session is gone on the server too.
  expect((await page.request.get('/api/export')).status()).toBe(401)

  await reloadApp(page)
  expect(await cardNames(page)).toEqual(['Timer', 'Stopwatch'])
  await expect(syncButton(page)).toHaveCount(0)
})

test('deleting the account signs out, keeps the cards and removes the server copy', async ({
  page,
  openDevice,
  allowedErrors,
}, testInfo) => {
  // The other device's last session check is refused (401), which the browser logs.
  allowedErrors.push(/status of 401/)
  const email = newEmail(testInfo)
  await openApp(page)
  await signInAndSync(page, email)
  // Another device of the account, online.
  const other = await openDevice()
  await openApp(other)
  await signInQuickly(other, email)
  await expectOnline(other)
  // The server has the card: the first exchange uploaded it.
  await expect
    .poll(async () => JSON.stringify(await (await page.request.get('/api/export')).json()))
    .toContain('"name":"Timer"')

  const dialog = await openAccount(page)
  await dialog.getByRole('button', { name: 'Delete account' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete your account?' })
  await expect(confirm).toBeVisible()
  const remove = confirm.getByRole('button', { name: 'Delete account' })
  const word = confirm.getByRole('textbox', { name: 'Type DELETE to confirm' })
  await word.fill('DELETE')
  await remove.click()

  await expect(confirm).toBeHidden()
  await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeFocused()
  await expect(dialogAnnouncer(page)).toHaveText('Account deleted. Your cards stay on this device.')
  await closeSettings(page)
  await expect(syncButton(page)).toHaveCount(0)
  expect(await cardNames(page)).toEqual(['Timer'])
  // The account and its session are gone.
  expect((await page.request.get('/api/export')).status()).toBe(401)

  // The other device learns it at once: signed out, its cards kept, no more connection attempts.
  await expect(syncButton(other)).toHaveCount(0, { timeout: 5_000 })
  expect(await cardNames(other)).toEqual(['Timer'])
  const otherDialog = await openAccount(other)
  await expect(otherDialog.getByRole('textbox', { name: 'Email' })).toBeVisible()
})

test('signing out from the cloud button gives focus back to Settings in the action bar', async ({
  page,
}, testInfo) => {
  await openApp(page)
  await signInAndSync(page, newEmail(testInfo))
  await syncButton(page).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Sign out' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // The cloud that opened Settings is gone; focus lands next to where it was.
  await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeFocused()
})

test('the sync connection answers its heartbeat and stays open', async ({ page }, testInfo) => {
  const sockets: WebSocket[] = []
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).pathname === '/api/sync') sockets.push(socket)
  })
  await openApp(page)
  await signInAndSync(page, newEmail(testInfo))
  const socket = sockets.at(-1)
  if (socket === undefined) throw new Error('no sync socket')
  const count = sockets.length
  const pong = socket.waitForEvent('framereceived', {
    predicate: (frame) => frame.payload === 'pong',
  })
  // The page shows again: the app checks the connection at once.
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await pong
  await page.waitForTimeout(1_000)
  expect(socket.isClosed()).toBe(false)
  expect(sockets).toHaveLength(count)
  await expectOnline(page)
})

test('sync can be turned off on a device while staying signed in', async ({ page }, testInfo) => {
  await openApp(page)
  await signInAndSync(page, newEmail(testInfo))
  const dialog = await openAccount(page)
  const toggle = dialog.getByRole('switch', { name: 'Sync this device' })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  await expect(dialog.locator('[data-sync-status]')).toContainText('Not syncing')
  await expect(dialog.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await closeSettings(page)
  await expect(syncButton(page)).toHaveAccessibleName('Account: Not syncing')
  // The choice stays across a reload, and turning it on syncs again.
  await reloadApp(page)
  await expect(syncButton(page)).toHaveAccessibleName('Account: Not syncing')
  await openAccount(page)
  await dialog.getByRole('switch', { name: 'Sync this device' }).click()
  await closeSettings(page)
  await expectOnline(page)
})

test('downloads the server copy of the synced data', async ({ page }, testInfo) => {
  await openApp(page)
  await signInAndSync(page, newEmail(testInfo))
  const dialog = await openAccount(page)

  const downloading = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download server copy' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/^timer-app-server-copy-\d{4}-\d{2}-\d{2}\.json$/)
  const file = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    app: string
    kind: string
    tables: { cards?: Record<string, { name: string }> }
  }
  expect(file).toMatchObject({ app: 'timer-app', kind: 'server-copy' })
  expect(Object.values(file.tables.cards ?? {}).map((card) => card.name)).toEqual(['Timer'])
  await expect(dialog.getByText(`Saved ${download.suggestedFilename()}`)).toBeVisible()
})

test.describe('provider buttons', () => {
  test('are hidden while the server has no provider credentials', async ({ page }) => {
    await openApp(page)
    const config = (await (await page.request.get('/api/config')).json()) as {
      providers: string[]
    }
    expect(config.providers).toEqual([])
    const dialog = await openAccount(page)
    await expect(dialog.getByRole('button', { name: 'Send code' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /^Continue with / })).toHaveCount(0)
  })

  test('show one button per configured provider, in a fixed order', async ({ page }) => {
    // The server has no OAuth credentials in the tests; pretend it has two.
    await page.route('**/api/config', (route) =>
      route.fulfill({ json: { providers: ['github', 'google'], appEnv: 'development' } }),
    )
    await openApp(page)
    const dialog = await openAccount(page)
    await expect(dialog.getByRole('button', { name: /^Continue with / })).toHaveText([
      'Continue with Google',
      'Continue with GitHub',
    ])
  })
})

test('back from a provider sign-in that failed, the app shows why in Settings › Account', async ({
  page,
}) => {
  await page.route('**/api/config', (route) =>
    route.fulfill({ json: { providers: ['github'], appEnv: 'development' } }),
  )
  // Better Auth sends the browser back to the page it left, with the provider's error.
  await page.goto('/?error=access_denied&error_description=The+user+said+no')
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Account' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    dialog.getByText("Signing in with that account didn't finish. Try again."),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible()
  // The error is taken off the address, so a reload starts clean.
  expect(new URL(page.url()).search).toBe('')
})

test('a code for one address does not sign in another', async ({
  page,
  allowedErrors,
}, testInfo) => {
  allowedErrors.push(/status of 400/)
  const first = newEmail(testInfo, 'first')
  const second = newEmail(testInfo, 'second')
  await openApp(page)
  // A code is sent to the first address…
  const dialog = await signIn(page, first)
  // (Signed in, sync connects; signing out before it has would refuse the connection under way.)
  await expect(dialog.locator('[data-sync-status]')).toHaveAttribute('data-sync-status', 'online')
  await dialog.getByRole('button', { name: 'Sign out' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeFocused()
  const firstCode = await devCode(page, first)

  // …and tried for the second one.
  await dialog.getByRole('textbox', { name: 'Email' }).fill(second)
  await dialog.getByRole('button', { name: 'Send code' }).click()
  const field = dialog.getByRole('textbox', { name: 'Code', exact: true })
  await expect(field).toBeFocused()
  const secondCode = await devCode(page, second)
  test.skip(firstCode === secondCode, 'the two random codes happen to match')
  await field.fill(firstCode)
  await expect(dialog.getByText("That code isn't right. Check it and try again.")).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})
