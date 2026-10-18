import {
  announcer,
  cardCells,
  digitsOf,
  expect,
  openApp,
  openWithPausedClock,
  selectedCard,
  test,
} from './support'

// The end-time chip is checked against an exact clock time.
test.use({ locale: 'en-US', timezoneId: 'UTC' })

/**
 * The end-time chip's text for `at` in en-US and UTC: "Ends at 4:31 PM" ("Ends at" is for screen
 * readers). ICU puts a narrow no-break space before PM, so any space matches there.
 */
function clockTimePattern(at: number): RegExp {
  const date = new Date(at)
  const hours = date.getUTCHours()
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  const hour12 = hours % 12 === 0 ? 12 : hours % 12
  const meridiem = hours < 12 ? 'AM' : 'PM'
  return new RegExp(`^\\s*Ends at\\s${String(hour12)}:${minutes}\\s${meridiem}\\s*$`)
}

test('the first run shows one selected 5:00 timer named Timer', async ({ page }) => {
  await openApp(page)
  const card = cardCells(page).first()
  await expect(card).toHaveAccessibleName('Timer')
  await expect(card).toHaveAttribute('aria-selected', 'true')
  await expect(card).toHaveAttribute('data-kind', 'timer')
  await expect(card).toHaveAttribute('data-phase', 'idle')
  await expect(digitsOf(card)).toHaveText('5:00')
  await expect(card.getByRole('button', { name: 'Start' })).toBeEnabled()
  await expect(page.getByRole('grid', { name: 'Cards' })).toBeVisible()
})

test('typed digits set the duration; Enter, Space and R start, pause, resume and reset', async ({
  page,
}) => {
  const pausedAt = await openWithPausedClock(page)
  const card = selectedCard(page)
  const display = digitsOf(card)

  await page.keyboard.type('13030')
  await expect(display).toHaveText('01:30:30')

  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(display).toHaveText('1:30:30')
  const endTime = card.getByTestId('end-time')
  await expect(endTime).toBeVisible()
  await expect(endTime).toHaveText(clockTimePattern(pausedAt + 5_430_000))
  await expect(announcer(page)).toHaveText('Timer started, 1:30:30')

  await page.clock.runFor(1200)
  await expect(display).toHaveText('1:30:29')

  // Paused: the display holds still however long it waits.
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'paused')
  await expect(card.getByRole('button', { name: 'Resume' })).toBeVisible()
  await page.clock.runFor(3000)
  await expect(display).toHaveText('1:30:29')

  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await page.clock.runFor(1000)
  await expect(display).toHaveText('1:30:28')

  await page.keyboard.press('r')
  await expect(card).toHaveAttribute('data-phase', 'idle')
  await expect(display).toHaveText('1:30:30')
  await expect(endTime).toHaveCount(0)
})

test('a one-second timer rings, counts overtime, and Enter dismisses it', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  const display = digitsOf(card)

  await page.keyboard.type('1')
  await expect(display).toHaveText('00:00:01')
  await page.keyboard.press('Enter')
  await expect(display).toHaveText('0:01')

  // Countdowns round up: 0:01 until the exact end, then 0:00 as the alarm starts.
  await page.clock.runFor(1100)
  await expect(card).toHaveAttribute('data-phase', 'ringing')
  await expect(card.getByText("Time's up", { exact: true })).toBeVisible()
  await expect(display).toHaveText('0:00')
  await expect(card.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Restart' })).toBeVisible()
  await expect(announcer(page)).toHaveText("Timer: time's up")

  // Overtime counts up with a real minus sign (U+2212).
  await page.clock.runFor(1000)
  await expect(display).toHaveText('−0:01')

  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'idle')
  await expect(display).toHaveText('0:01')
  await expect(card.getByText("Time's up", { exact: true })).toHaveCount(0)
})

test('Esc discards typed digits and keeps the previous duration', async ({ page }) => {
  await openApp(page)
  const display = digitsOf(selectedCard(page))
  await page.keyboard.type('90')
  await expect(display).toHaveText('00:00:90')
  await page.keyboard.press('Backspace')
  await expect(display).toHaveText('00:00:09')
  await page.keyboard.press('Escape')
  await expect(display).toHaveText('5:00')
  await expect(selectedCard(page)).toHaveAttribute('data-phase', 'idle')
})

test('typed overflow is normalized on start (90 seconds runs as 1:30)', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await page.keyboard.type('90')
  await expect(digitsOf(card)).toHaveText('00:00:90')
  await page.keyboard.press('Enter')
  await expect(digitsOf(card)).toHaveText('1:30')
  await page.keyboard.press('r')
  await expect(digitsOf(card)).toHaveText('1:30')
})

test('hovering the time shows steppers that change the duration', async ({ page }) => {
  await openApp(page)
  const card = selectedCard(page)
  const display = digitsOf(card)
  await expect(display).toHaveText('5:00')

  await display.hover()
  const addMinute = card.getByRole('button', { name: 'Add a minute', exact: true })
  await expect(addMinute).toBeVisible()
  await addMinute.click()
  await expect(display).toHaveText('6:00')
  await card.getByRole('button', { name: 'Subtract a second', exact: true }).click()
  await expect(display).toHaveText('5:59')
  // The engine carries: a minute less than 1:59 is 0:59.
  const subtractMinute = card.getByRole('button', { name: 'Subtract a minute', exact: true })
  for (let press = 0; press < 5; press++) await subtractMinute.click()
  await expect(display).toHaveText('0:59')
  // No minute left to take away: that ▼ is disabled rather than clamping to 0:00.
  await expect(subtractMinute).toBeDisabled()
  await expect(card.getByRole('button', { name: 'Subtract a second', exact: true })).toBeEnabled()

  // ▲ and ▼ over minutes and seconds, all out of the tab order (the keyboard types digits).
  const steppers = card.getByRole('button', { name: /^(Add|Subtract) an? (hour|minute|second)$/ })
  await expect(steppers).toHaveCount(4)
  for (const stepper of await steppers.all()) {
    await expect(stepper).toHaveAttribute('tabindex', '-1')
  }

  // None while digits are typed, nor while the timer runs. A press left focus where it was, so
  // Space starts the timer rather than pressing a stepper again.
  await page.keyboard.type('1')
  await expect(steppers).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(steppers).toHaveCount(4)
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(steppers).toHaveCount(0)
})
