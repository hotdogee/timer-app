/**
 * Cards survive reloads and closing the page, and tabs stay in step (spec › Persistence and
 * instances): names, order and mute come back; a running timer keeps running with the right time
 * left; a timer that ended while the page was closed is ringing from its real end; deleting every
 * card does not bring the first-run card back; two pages of one browser share their cards live.
 */
import {
  appMounted,
  cardCells,
  cardNamed,
  cardNames,
  digitsOf,
  expect,
  openApp,
  openWithPausedClock,
  reloadApp,
  savedAfter,
  selectedCard,
  test,
} from './support'

// Three cards fit in one row, so left and right walk the whole list.
test.use({ viewport: { width: 1280, height: 800 } })

test('card names, order and mute survive a reload', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('Shift+N')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 2', 'Stopwatch'])

  // Rename Timer 2, move the stopwatch to the front and mute Timer.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('F2')
  await page.keyboard.type('Laundry')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Control+ArrowLeft')
  await page.keyboard.press('Control+ArrowLeft')
  await expect.poll(() => cardNames(page)).toEqual(['Stopwatch', 'Timer', 'Laundry'])
  await savedAfter(page, async () => {
    await cardNamed(page, 'Timer').click()
    await page.keyboard.press('m')
    await expect(cardNamed(page, 'Timer').getByRole('button', { name: 'Mute' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  await reloadApp(page)
  await expect.poll(() => cardNames(page)).toEqual(['Stopwatch', 'Timer', 'Laundry'])
  // The selection is per tab and not saved: the first card is selected after a load.
  await expect(selectedCard(page)).toHaveAccessibleName('Stopwatch')
  await expect(cardNamed(page, 'Timer').getByRole('button', { name: 'Mute' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(cardNamed(page, 'Laundry').getByRole('button', { name: 'Mute' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(cardNamed(page, 'Stopwatch')).toHaveAttribute('data-kind', 'stopwatch')
})

test('a running timer keeps running across a reload with the right time left', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await savedAfter(page, async () => {
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('data-phase', 'running')
  })
  await page.clock.runFor(10_000)
  await expect(digitsOf(card)).toHaveText('4:50')

  // The page clock stays paused across the reload, at the same time.
  await reloadApp(page)
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(digitsOf(card)).toHaveText('4:50')
  await page.clock.runFor(1100)
  await expect(digitsOf(card)).toHaveText('4:49')
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'paused')
})

test('a timer that ends while the page is closed is ringing when it opens', async ({
  page,
  context,
}) => {
  const pausedAt = await openWithPausedClock(page)
  const card = selectedCard(page)
  await page.keyboard.type('100')
  await savedAfter(page, async () => {
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('data-phase', 'running')
  })
  await expect(digitsOf(card)).toHaveText('1:00')
  await page.close()

  // Two minutes pass while no page is open: the timer ended a minute ago.
  await context.clock.setSystemTime(pausedAt + 120_000)
  const reopened = await context.newPage()
  await reopened.goto('/')
  await appMounted(reopened)
  const ringing = selectedCard(reopened)
  await expect(ringing).toHaveAttribute('data-phase', 'ringing')
  await expect(ringing.getByText("Time's up", { exact: true })).toBeVisible()
  // Overtime counts from the real end, not from when the page opened.
  await expect(digitsOf(ringing)).toHaveText('−1:00')
  await reopened.keyboard.press('Enter')
  await expect(ringing).toHaveAttribute('data-phase', 'idle')
  await expect(digitsOf(ringing)).toHaveText('1:00')
})

test('deleting every card and reloading shows the empty state, not a new card', async ({
  page,
}) => {
  await openApp(page)
  await savedAfter(page, async () => {
    await page.keyboard.press('Delete')
    await expect(cardCells(page)).toHaveCount(0)
  })
  await reloadApp(page)
  await expect(page.locator('[data-empty-state]')).toBeVisible()
  await expect(cardCells(page)).toHaveCount(0)
  // The presets were seeded once too, and are not added again.
  await page.keyboard.press('p')
  await expect(page.getByRole('menu', { name: 'New timer' }).getByRole('menuitem')).toHaveText([
    /Timer\s*5:00/,
    /Tea\s*3:00/,
    /Pomodoro\s*25:00/,
    /Break\s*5:00/,
    /Eggs\s*7:00/,
  ])
})

test('two pages stay in step: a card added and started in one runs in the other', async ({
  page,
  context,
}) => {
  await openApp(page)
  const other = await context.newPage()
  await other.goto('/')
  await expect(cardCells(other)).toHaveCount(1)

  await page.keyboard.press('n')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 2')
  await page.keyboard.press('Enter')
  await expect(selectedCard(page)).toHaveAttribute('data-phase', 'running')
  const mirrored = cardNamed(other, 'Timer 2')
  await expect(mirrored).toHaveAttribute('data-phase', 'running', { timeout: 2000 })
  // The other page shows the same countdown, from the shared start time.
  await expect(digitsOf(mirrored)).toHaveText(/^4:5\d$/)
  // Its selection is its own.
  await expect(selectedCard(other)).toHaveAccessibleName('Timer')

  // A rename in the second page shows in the first.
  await other.keyboard.press('F2')
  await other.keyboard.type('Tea')
  await other.keyboard.press('Enter')
  await expect.poll(() => cardNames(other)).toEqual(['Tea', 'Timer 2'])
  await expect.poll(() => cardNames(page), { timeout: 2000 }).toEqual(['Tea', 'Timer 2'])

  // A pause in the first page reaches the second with the same time left.
  await cardNamed(page, 'Timer 2').getByRole('button', { name: 'Pause' }).click()
  await expect(mirrored).toHaveAttribute('data-phase', 'paused', { timeout: 2000 })
  await expect(digitsOf(mirrored)).toHaveText(
    (await digitsOf(cardNamed(page, 'Timer 2')).textContent()) ?? '',
  )
})
