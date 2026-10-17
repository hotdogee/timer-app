import type { Locator, Page } from '@playwright/test'

import {
  cardCells,
  digitsOf,
  expect,
  openApp,
  openWithPausedClock,
  selectedCard,
  test,
} from './support'

function palette(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Command palette' })
}

function searchField(page: Page): Locator {
  return palette(page).getByRole('combobox', { name: 'Search commands' })
}

function options(page: Page): Locator {
  return palette(page).getByRole('listbox', { name: 'Commands' }).getByRole('option')
}

test('Mod+K opens the palette; "stop" + Enter creates a stopwatch', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeVisible()
  await expect(searchField(page)).toBeFocused()

  await page.keyboard.type('stop')
  await expect(options(page).first()).toContainText('New stopwatch')
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')

  await expect(palette(page)).toBeHidden()
  await expect(cardCells(page)).toHaveCount(2)
  await expect(selectedCard(page)).toHaveAccessibleName('Stopwatch')
  await expect(selectedCard(page)).toHaveAttribute('data-phase', 'idle')
})

test('typing 90 in the palette creates and starts a 1:30 timer', async ({ page }) => {
  await openWithPausedClock(page)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(searchField(page)).toBeFocused()
  await page.keyboard.type('90')
  const first = options(page).first()
  await expect(first).toContainText('New timer 00:00:90')
  await expect(first).toContainText('1:30')
  await page.keyboard.press('Enter')

  await expect(palette(page)).toBeHidden()
  await expect(cardCells(page)).toHaveCount(2)
  const card = selectedCard(page)
  await expect(card).toHaveAccessibleName('Timer 2')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(digitsOf(card)).toHaveText('1:30')
  await page.clock.runFor(1100)
  await expect(digitsOf(card)).toHaveText('1:29')
})

test('the palette’s Start applies typed digits first, as Space does', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await page.keyboard.type('90')
  await expect(digitsOf(card)).toHaveText('00:00:90')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(options(page).first()).toContainText('Start')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(digitsOf(card)).toHaveText('1:30')
})

test('the palette lists commands with shortcuts, moves with arrows and closes with Mod+K', async ({
  page,
}) => {
  await openApp(page)
  await page.keyboard.press('ControlOrMeta+k')
  await expect(options(page).first()).toHaveAttribute('aria-selected', 'true')
  await expect(options(page).first()).toContainText('Start')

  await page.keyboard.press('ArrowDown')
  await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(palette(page).locator('[aria-selected="true"]')).toHaveCount(1)
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(options(page).last()).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.type('zzzz')
  await expect(palette(page).getByText('No matching commands')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette(page)).toBeHidden()

  // The palette opens empty again, and Esc closes it without leaving anything behind.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(searchField(page)).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(palette(page)).toBeHidden()
  await expect(cardCells(page)).toHaveCount(1)
})

test('? opens the shortcut cheat sheet and Esc closes it', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toBeVisible()
  for (const section of ['Timer', 'Stopwatch', 'Cards', 'Navigation', 'App']) {
    await expect(help.getByRole('heading', { name: section, exact: true })).toBeVisible()
  }
  await expect(help.getByText('Ctrl+K').or(help.getByText('⌘K'))).toBeVisible()

  // Keys typed while the sheet is open do not reach the cards.
  await page.keyboard.press('n')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()
  await expect(cardCells(page)).toHaveCount(1)

  // ? toggles it, and the palette's "Keyboard shortcuts" command opens it too.
  await page.keyboard.press('?')
  await expect(help).toBeVisible()
  await page.keyboard.press('?')
  await expect(help).toBeHidden()
  await page.keyboard.press('ControlOrMeta+k')
  await page.keyboard.type('keyboard')
  await page.keyboard.press('Enter')
  await expect(palette(page)).toBeHidden()
  await expect(help).toBeVisible()
  await help.getByRole('button', { name: 'Close' }).click()
  await expect(help).toBeHidden()
})
