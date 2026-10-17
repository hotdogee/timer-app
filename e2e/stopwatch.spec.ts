import { digitsOf, expect, openWithPausedClock, selectedCard, test } from './support'

test('Space starts a stopwatch, L records laps newest first, Space pauses, R resets', async ({
  page,
}) => {
  await openWithPausedClock(page)
  await page.keyboard.press('Shift+N')
  const card = selectedCard(page)
  await expect(card).toHaveAccessibleName('Stopwatch')
  const display = digitsOf(card)
  await expect(display).toHaveText('0.00')

  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(card.getByRole('button', { name: 'Lap' })).toBeVisible()
  await page.clock.runFor(1500)
  await page.keyboard.press('l')
  await expect(display).toHaveText('1.50')
  await page.clock.runFor(2000)
  await page.keyboard.press('l')
  await expect(display).toHaveText('3.50')

  // The lap in progress on top, then the recorded laps newest first: lap, lap time, total.
  const rows = card.getByRole('region', { name: 'Laps' }).locator('tbody tr')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0).locator('td')).toHaveText(['3', '0.00', '3.50'])
  await expect(rows.nth(1).locator('td')).toHaveText(['2', '2.00', '3.50'])
  await expect(rows.nth(2).locator('td')).toHaveText(['1', '1.50', '1.50'])

  await page.clock.runFor(250)
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'paused')
  await expect(display).toHaveText('3.75')
  await expect(rows.nth(0).locator('td')).toHaveText(['3', '0.25', '3.75'])
  // Paused: nothing moves, and L records nothing.
  await page.clock.runFor(2000)
  await page.keyboard.press('l')
  await expect(display).toHaveText('3.75')
  await expect(rows).toHaveCount(3)

  await page.keyboard.press('r')
  await expect(card).toHaveAttribute('data-phase', 'idle')
  await expect(display).toHaveText('0.00')
  await expect(card.getByRole('region', { name: 'Laps' })).toHaveCount(0)
})
