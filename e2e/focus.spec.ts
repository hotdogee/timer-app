/**
 * Focus and screen-reader flows (spec › Accessibility): focus survives reordering, controls that
 * swap out, edit mode ending and the last card going away; the focus ring differs from the
 * selection ring; and announcements reach screen readers while a dialog or a fullscreen card makes
 * the rest of the page inert.
 */
import {
  announcer,
  cardNamed,
  cardNames,
  dialogAnnouncer,
  expect,
  openApp,
  openWithPausedClock,
  selectedCard,
  test,
} from './support'

// Three cards fit in one row at this width.
test.use({ viewport: { width: 1280, height: 800 } })

test('Ctrl+Arrow keeps focus on the moved card and announces where it went', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('n')
  const card = cardNamed(page, 'Timer 2')
  await card.focus()

  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 3', 'Timer 2'])
  await expect(card).toBeFocused()
  await expect(announcer(page)).toHaveText('Moved Timer 2 to position 3 of 3')

  await page.keyboard.press('Control+ArrowLeft')
  await page.keyboard.press('Control+ArrowLeft')
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2', 'Timer', 'Timer 3'])
  await expect(card).toBeFocused()
})

test('arrow keys on a drag handle keep moving the card, step after step', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('n')
  await page.keyboard.press('e')
  const handle = page.getByRole('button', { name: 'Move Timer', exact: true })
  await handle.focus()

  await page.keyboard.press('ArrowRight')
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2', 'Timer', 'Timer 3'])
  await expect(handle).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2', 'Timer 3', 'Timer'])
  await expect(handle).toBeFocused()
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
})

test('pressing Start, Pause and Reset keeps focus on the control in their place', async ({
  page,
}) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await card.getByRole('button', { name: 'Start' }).focus()

  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(card.getByRole('button', { name: 'Pause' })).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'paused')
  await expect(card.getByRole('button', { name: 'Resume' })).toBeFocused()

  await page.keyboard.press('Tab')
  await expect(card.getByRole('button', { name: 'Reset' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'idle')
  await expect(card.getByRole('button', { name: 'Start' })).toBeFocused()
})

test('when time is up, focus on a control moves to Dismiss', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  await card.getByRole('button', { name: 'Pause' }).focus()
  await page.clock.runFor(1100)
  await expect(card).toHaveAttribute('data-phase', 'ringing')
  await expect(card.getByRole('button', { name: 'Dismiss' })).toBeFocused()
})

test('leaving edit mode from a delete button gives focus to its card', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('e')
  await page.getByRole('button', { name: 'Delete Timer 2', exact: true }).focus()
  await page.keyboard.press('e')
  await expect(page.getByRole('button', { name: 'Delete Timer 2', exact: true })).toHaveCount(0)
  await expect(cardNamed(page, 'Timer 2')).toBeFocused()

  // Esc leaving edit mode from a name field does the same.
  await page.keyboard.press('e')
  await cardNamed(page, 'Timer').getByRole('textbox', { name: 'Card name' }).focus()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('textbox', { name: 'Card name' })).toHaveCount(0)
  await expect(cardNamed(page, 'Timer')).toBeFocused()
})

test('deleting the last card focuses "New timer"', async ({ page }) => {
  await openApp(page)
  await selectedCard(page).focus()
  await page.keyboard.press('Delete')
  await expect(page.getByRole('heading', { name: 'No timers yet' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'New timer', exact: true }).first()).toBeFocused()

  // Undo from there brings the card back, focused.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
  await expect(selectedCard(page)).toBeFocused()
})

test('the focused card shows a double ring, the merely selected one a single ring', async ({
  page,
}) => {
  await openApp(page)
  const card = selectedCard(page)
  const outline = () => card.evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(await outline()).toBe('solid')
  await page.keyboard.press('Tab')
  await expect(card).toBeFocused()
  expect(await outline()).toBe('double')
})

test('a card describes its kind, state and time to screen readers', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await expect(card).toHaveAccessibleName('Timer')
  await expect(card).toHaveAccessibleDescription('Timer, ready 00:05:00')
  await page.keyboard.press('Enter')
  await expect(card).toHaveAccessibleDescription('Timer, running 5:00')
})

test('time up is announced while the cheat sheet is open', async ({ page }) => {
  await openWithPausedClock(page)
  await page.keyboard.type('1')
  await page.keyboard.press('Enter')
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  // The dialog opens on its close button, a named control.
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused()
  await page.clock.runFor(1100)
  await expect(dialogAnnouncer(page)).toHaveText("Timer: time's up")
})

test('a natively fullscreen card carries the live region', async ({ page }) => {
  await openWithPausedClock(page)
  await page.keyboard.press('f')
  await expect
    .poll(() => selectedCard(page).evaluate((el) => document.fullscreenElement === el))
    .toBe(true)
  await page.keyboard.press('Enter')
  await expect(selectedCard(page).locator('[role="status"][aria-live="polite"]')).toHaveText(
    'Timer started, 5:00',
  )
})

test('a fullscreen card follows the selection', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('f')
  const shown = () => page.evaluate(() => document.fullscreenElement?.getAttribute('aria-label'))
  await expect.poll(shown).toBe('Timer 2')
  await page.keyboard.press('ArrowLeft')
  await expect.poll(shown).toBe('Timer')
  await page.keyboard.press('f')
  await expect.poll(shown).toBeUndefined()
})
