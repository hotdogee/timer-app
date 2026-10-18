/**
 * Cross-device sync (spec › Sync) against the real sync server: two browser contexts are two
 * devices signed in to one account. Signing in merges each device's cards into the account;
 * changes then reach the other device within two seconds (spec: about a second); a dismissed
 * alarm stops ringing everywhere, also on a device that was closed meanwhile; a device that was
 * offline catches up when it is back; behavior settings and presets sync while appearance and
 * language stay on each device; and the server-time offset corrects a device clock that is wrong.
 */
import type { Locator, Page, TestInfo } from '@playwright/test'

import {
  expectOnline,
  newEmail,
  signIn,
  signInAndSync,
  signInQuickly,
  syncButton,
} from './accounts'
import {
  cardCells,
  cardNamed,
  cardNames,
  closeSettings,
  digitsOf,
  expect,
  openApp,
  openSettings,
  test,
} from './support'

// The end-time chip is checked against an exact clock time.
test.use({ locale: 'en-US', timezoneId: 'UTC' })

/** How long a change may take to reach the other device. */
const SYNC_TIMEOUT = 2_000

/** Renames card `from` through its name field (F2), from the keyboard. */
async function rename(page: Page, from: string, to: string): Promise<void> {
  // A click anywhere on a card selects it.
  await cardNamed(page, from).getByRole('heading', { name: from }).click()
  await page.keyboard.press('F2')
  await expect(page.getByRole('textbox', { name: 'Card name' })).toBeFocused()
  // The field opens with the name selected, so typing replaces it.
  await page.keyboard.type(to)
  await page.keyboard.press('Enter')
  await expect(cardNamed(page, to)).toBeVisible()
}

/** Creates and starts a timer from the command palette: "New timer 00:00:<seconds>". */
async function startNewTimer(page: Page, seconds: number): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  const search = page.getByRole('combobox', { name: 'Search commands' })
  await expect(search).toBeFocused()
  await page.keyboard.type(String(seconds))
  await page.keyboard.press('Enter')
  await expect(search).toBeHidden()
}

/**
 * Two devices signed in to one new account, both connected: `first` (the test's page) renames
 * its first-run timer to Kitchen and signs in through the form; `second` (a new context) adds a
 * stopwatch and signs in directly. Both then hold Kitchen and Stopwatch.
 */
async function twoDevices(
  first: Page,
  openDevice: () => Promise<Page>,
  testInfo: TestInfo,
): Promise<Page> {
  const email = newEmail(testInfo)
  await openApp(first)
  await rename(first, 'Timer', 'Kitchen')
  await signInAndSync(first, email)

  const second = await openDevice()
  await openApp(second)
  await second.getByRole('button', { name: 'New stopwatch' }).click()
  await expect(cardNamed(second, 'Stopwatch')).toBeVisible()
  await signInQuickly(second, email)
  await expectOnline(second)
  // Signing in merged each device's cards into the account. The first-run timers are one card
  // (they share an id), and the rename made on the first device wins over the second device's
  // first-run defaults, although those were written later.
  await expect.poll(() => cardNames(second)).toEqual(['Kitchen', 'Stopwatch'])
  await expect.poll(() => cardNames(first)).toEqual(['Kitchen', 'Stopwatch'])
  return second
}

test('signing in merges the cards; a card added, started and renamed on one device follows on the other', async ({
  page,
  openDevice,
}, testInfo) => {
  const other = await twoDevices(page, openDevice, testInfo)

  await page.getByRole('button', { name: 'New stopwatch' }).click()
  await cardNamed(page, 'Stopwatch 2').getByRole('button', { name: 'Start' }).click()
  await expect(cardNamed(page, 'Stopwatch 2')).toHaveAttribute('data-phase', 'running')
  const mirrored = cardNamed(other, 'Stopwatch 2')
  await expect(mirrored).toHaveAttribute('data-phase', 'running', { timeout: SYNC_TIMEOUT })
  expect(await cardNames(other)).toEqual(['Kitchen', 'Stopwatch', 'Stopwatch 2'])

  await rename(page, 'Stopwatch 2', 'Laps')
  await expect(cardNamed(other, 'Laps')).toBeVisible({ timeout: SYNC_TIMEOUT })
  await expect(cardNamed(other, 'Laps')).toHaveAttribute('data-phase', 'running')

  // And the other way: a pause on the second device stops the stopwatch on the first.
  await cardNamed(other, 'Laps').getByRole('button', { name: 'Pause' }).click()
  await expect(cardNamed(page, 'Laps')).toHaveAttribute('data-phase', 'paused', {
    timeout: SYNC_TIMEOUT,
  })
  // Both show the same elapsed time once paused.
  await expect(digitsOf(cardNamed(page, 'Laps'))).toHaveText(
    (await digitsOf(cardNamed(other, 'Laps')).textContent()) ?? '',
  )
})

test('a ringing timer rings on every device, and dismissing it on one stops it on all', async ({
  page,
  openDevice,
}, testInfo) => {
  const other = await twoDevices(page, openDevice, testInfo)

  await startNewTimer(page, 3)
  const here = cardNamed(page, 'Timer')
  const there = cardNamed(other, 'Timer')
  await expect(here).toHaveAttribute('data-phase', 'running')
  await expect(there).toHaveAttribute('data-phase', 'running', { timeout: SYNC_TIMEOUT })

  await expect(here).toHaveAttribute('data-phase', 'ringing', { timeout: 6_000 })
  await expect(there).toHaveAttribute('data-phase', 'ringing', { timeout: 6_000 })

  await there.getByRole('button', { name: 'Dismiss' }).click()
  await expect(there).toHaveAttribute('data-phase', 'idle')
  await expect(here).toHaveAttribute('data-phase', 'idle', { timeout: SYNC_TIMEOUT })
})

test('a device that was offline catches up both ways when it is back', async ({
  page,
  openDevice,
  allowedErrors,
}, testInfo) => {
  // Offline, the browser logs the sync connection's failed attempts.
  allowedErrors.push(/ERR_INTERNET_DISCONNECTED/)
  const other = await twoDevices(page, openDevice, testInfo)

  await other.context().setOffline(true)
  await expect(syncButton(other)).toHaveAttribute('data-sync-status', 'offline')
  await expect(syncButton(other)).toHaveAccessibleName('Account: Offline')

  // Changes on both sides while apart.
  await rename(page, 'Kitchen', 'Pantry')
  await other.getByRole('button', { name: 'New stopwatch' }).click()
  await expect(cardNamed(other, 'Stopwatch 2')).toBeVisible()
  await other.waitForTimeout(1_000)
  expect(await cardNames(other)).toEqual(['Kitchen', 'Stopwatch', 'Stopwatch 2'])
  expect(await cardNames(page)).toEqual(['Pantry', 'Stopwatch'])

  // Back online it reconnects at once and both sides converge.
  await other.context().setOffline(false)
  await expectOnline(other)
  await expect
    .poll(() => cardNames(other), { timeout: SYNC_TIMEOUT })
    .toEqual(['Pantry', 'Stopwatch', 'Stopwatch 2'])
  await expect
    .poll(() => cardNames(page), { timeout: SYNC_TIMEOUT })
    .toEqual(['Pantry', 'Stopwatch', 'Stopwatch 2'])
})

/**
 * The end-time chip's text for `at` in en-US and UTC ("Ends at 4:31 PM"; "Ends at" is for screen
 * readers), for either minute when `from` and `to` straddle one. ICU puts a narrow no-break space
 * before PM, so any space matches there.
 */
function endTimePattern(from: number, to: number): RegExp {
  const clock = (at: number): string => {
    const date = new Date(at)
    const hours = date.getUTCHours()
    const minutes = String(date.getUTCMinutes()).padStart(2, '0')
    const hour12 = hours % 12 === 0 ? 12 : hours % 12
    return `${String(hour12)}:${minutes}\\s${hours < 12 ? 'AM' : 'PM'}`
  }
  return new RegExp(`^\\s*Ends at\\s(?:${clock(from)}|${clock(to)})\\s*$`)
}

/** Starts card `name`'s 5:00 timer; resolves to the device time just before and after the click. */
async function startFiveMinutes(page: Page, name: string): Promise<[number, number]> {
  const before = await page.evaluate(() => Date.now())
  await cardNamed(page, name).getByRole('button', { name: 'Start' }).click()
  const after = await page.evaluate(() => Date.now())
  await expect(cardNamed(page, name)).toHaveAttribute('data-phase', 'running')
  return [before, after]
}

test('while signed in, app time follows the server clock; signed out it is the device clock', async ({
  page,
}, testInfo) => {
  // This device's clock reads two minutes behind the server's. (More than five minutes would also
  // work for the clock, but TinyBase ignores changes stamped that far ahead of its own clock, so
  // the real server would ignore this device's changes: its clock is not the stub's.)
  const skew = 2 * 60_000
  let samples = 0
  await page.route('**/api/time', async (route) => {
    samples++
    await route.fulfill({
      json: { now: Date.now() + skew },
      headers: { 'Cache-Control': 'no-store' },
    })
  })
  await openApp(page)
  const fiveMinutes = 300_000

  // Signed out: nothing measures, and a timer ends 5 minutes from the device clock.
  let [before, after] = await startFiveMinutes(page, 'Timer')
  const endTime = cardNamed(page, 'Timer').getByTestId('end-time')
  await expect(endTime).toHaveText(endTimePattern(before + fiveMinutes, after + fiveMinutes))
  expect(samples).toBe(0)
  await cardNamed(page, 'Timer').getByRole('button', { name: 'Reset' }).click()

  // Signing in measures the offset (three samples), so the next timer ends two minutes later by
  // the device clock: at the server's time plus 5 minutes.
  const dialog = await signIn(page, newEmail(testInfo))
  await closeSettings(page)
  await expectOnline(page)
  await expect.poll(() => samples).toBeGreaterThanOrEqual(3)
  ;[before, after] = await startFiveMinutes(page, 'Timer')
  await expect(endTime).toHaveText(
    endTimePattern(before + skew + fiveMinutes, after + skew + fiveMinutes),
  )
  // The countdown does not jump: it counts from the same corrected clock.
  await expect(digitsOf(cardNamed(page, 'Timer'))).toHaveText(/^(5:00|4:5\d)$/)
  await cardNamed(page, 'Timer').getByRole('button', { name: 'Reset' }).click()

  // Signing out drops the offset again.
  await page.keyboard.press('ControlOrMeta+,')
  await dialog.getByRole('button', { name: 'Sign out' }).click()
  await expect(dialog.getByRole('textbox', { name: 'Email' })).toBeFocused()
  await closeSettings(page)
  ;[before, after] = await startFiveMinutes(page, 'Timer')
  await expect(endTime).toHaveText(endTimePattern(before + fiveMinutes, after + fiveMinutes))
})

test('two devices show the same remaining time although one device clock is wrong', async ({
  page,
  openDevice,
}, testInfo) => {
  // The first device's clock is three minutes slow; the server and the second device are right.
  const slow = 3 * 60_000
  await page.clock.install({ time: Date.now() - slow })
  let samples = 0
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/time') samples++
  })
  const other = await twoDevices(page, openDevice, testInfo)
  // The slow device measured its offset when it signed in.
  await expect.poll(() => samples).toBeGreaterThanOrEqual(3)

  // Started on the slow device, the timer reads 5:00 on the other one too, not 2:00.
  await cardNamed(page, 'Kitchen').getByRole('button', { name: 'Start' }).click()
  const there = cardNamed(other, 'Kitchen')
  await expect(there).toHaveAttribute('data-phase', 'running', { timeout: SYNC_TIMEOUT })
  await expect(digitsOf(there)).toHaveText(/^(5:00|4:5\d)$/)
  await expect(digitsOf(cardNamed(page, 'Kitchen'))).toHaveText(/^(5:00|4:5\d)$/)
})

test.describe('a device that was closed while a timer ended', () => {
  /**
   * Both devices hold a running timer of `seconds`; the second device closes; the first device
   * does `act`; once the timer would have ended, the second device opens again (it sees the timer
   * end by itself) and syncs. Returns both devices' card for the timer.
   */
  async function closedWhileItEnded(
    page: Page,
    openDevice: () => Promise<Page>,
    testInfo: TestInfo,
    seconds: number,
    act: (card: Locator) => Promise<void>,
  ): Promise<{ here: Locator; there: Locator }> {
    const other = await twoDevices(page, openDevice, testInfo)
    await startNewTimer(page, seconds)
    const here = cardNamed(page, 'Timer')
    await expect(cardNamed(other, 'Timer')).toHaveAttribute('data-phase', 'running', {
      timeout: SYNC_TIMEOUT,
    })
    // Long enough for the second device to have saved the running timer.
    await other.waitForTimeout(500)
    const device = other.context()
    await other.close()

    await act(here)
    // Past the end on every clock.
    await page.waitForTimeout(seconds * 1000 + 1_000)

    const reopened = await device.newPage()
    await reopened.goto('/')
    await expectOnline(reopened)
    return { here, there: cardNamed(reopened, 'Timer') }
  }

  test('cannot bring back an alarm dismissed elsewhere meanwhile', async ({
    page,
    openDevice,
  }, testInfo) => {
    const { here, there } = await closedWhileItEnded(
      page,
      openDevice,
      testInfo,
      3,
      async (card) => {
        await expect(card).toHaveAttribute('data-phase', 'ringing', { timeout: 6_000 })
        await card.getByRole('button', { name: 'Dismiss' }).click()
        await expect(card).toHaveAttribute('data-phase', 'idle')
      },
    )
    await expect(there).toHaveAttribute('data-phase', 'idle', { timeout: SYNC_TIMEOUT })
    // And the first device stays dismissed.
    await page.waitForTimeout(1_000)
    await expect(here).toHaveAttribute('data-phase', 'idle')
  })

  test('cannot undo a pause made elsewhere before the end', async ({
    page,
    openDevice,
  }, testInfo) => {
    const { here, there } = await closedWhileItEnded(
      page,
      openDevice,
      testInfo,
      4,
      async (card) => {
        await card.getByRole('button', { name: 'Pause' }).click()
        await expect(card).toHaveAttribute('data-phase', 'paused')
      },
    )
    await expect(there).toHaveAttribute('data-phase', 'paused', { timeout: SYNC_TIMEOUT })
    await page.waitForTimeout(1_000)
    await expect(here).toHaveAttribute('data-phase', 'paused')
  })
})

test('a fresh device keeps the first-run timer it used, although the account deleted it', async ({
  page,
  openDevice,
}, testInfo) => {
  const email = newEmail(testInfo)
  // The account's device deleted its first-run timer, then signed in.
  await openApp(page)
  await cardNamed(page, 'Timer').getByRole('heading', { name: 'Timer' }).click()
  await page.keyboard.press('Delete')
  await expect(cardCells(page)).toHaveCount(0)
  await signInAndSync(page, email)

  // Later a new device renames and starts its own first-run timer, then signs in.
  const second = await openDevice()
  await openApp(second)
  await rename(second, 'Timer', 'Laundry')
  await cardNamed(second, 'Laundry').getByRole('button', { name: 'Start' }).click()
  await expect(cardNamed(second, 'Laundry')).toHaveAttribute('data-phase', 'running')
  await signInQuickly(second, email)
  await expectOnline(second)

  // The card the new device used is newer than the deletion: it stays, and reaches the account.
  await expect.poll(() => cardNames(second), { timeout: SYNC_TIMEOUT }).toEqual(['Laundry'])
  await expect(cardNamed(second, 'Laundry')).toHaveAttribute('data-phase', 'running')
  await expect.poll(() => cardNames(page), { timeout: SYNC_TIMEOUT }).toEqual(['Laundry'])
  await expect(cardNamed(page, 'Laundry')).toHaveAttribute('data-phase', 'running')
})

test('behavior settings and presets sync; appearance and language stay on each device', async ({
  page,
  openDevice,
}, testInfo) => {
  const other = await twoDevices(page, openDevice, testInfo)

  const dialog = await openSettings(page, 'Behavior')
  await dialog
    .getByRole('radiogroup', { name: 'Time format' })
    .getByRole('radio', { name: 'Fixed' })
    .check()
  await dialog.getByRole('tab', { name: 'Presets', exact: true }).click()
  const name = dialog.getByRole('textbox', { name: 'Preset name' }).first()
  await expect(name).toHaveValue('Tea')
  await name.fill('Green tea')
  await page.keyboard.press('Enter')
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click()
  await dialog
    .getByRole('radiogroup', { name: 'Theme' })
    .getByRole('radio', { name: 'Dark' })
    .check()
  await dialog.getByLabel('Language', { exact: true }).selectOption('ja')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ja')

  // Behavior and presets arrive on the other device...
  await expect(digitsOf(cardNamed(other, 'Kitchen'))).toHaveText('00:05:00', {
    timeout: SYNC_TIMEOUT,
  })
  await other.getByRole('button', { name: 'New timer', exact: true }).click()
  await expect(
    other.getByRole('menu', { name: 'New timer' }).getByRole('menuitem').nth(1),
  ).toContainText('Green tea')
  await other.keyboard.press('Escape')
  // ...the theme and the language do not.
  await expect(other.locator('html')).not.toHaveAttribute('data-theme')
  await expect(other.locator('html')).toHaveAttribute('lang', 'en')
})
