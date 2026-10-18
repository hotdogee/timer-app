/**
 * Card icons: the header's icon button opens an emoji picker, whose pick becomes the card's icon
 * in place of the kind's (saved like the rest of the card), and "Use the default icon" takes it
 * away. The picker works from the keyboard: the search has focus, arrows move through the emoji,
 * Enter picks, Esc closes without a change.
 */
import type { Locator, Page } from '@playwright/test'

import { expect, openApp, reloadApp, savedAfter, selectedCard, test } from './support'

/** The emoji picker dialog. */
function picker(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Choose an icon' })
}

test('a picked emoji becomes the card’s icon, stays after a reload, and can be cleared', async ({
  page,
}) => {
  await openApp(page)
  const iconButton = selectedCard(page).getByRole('button', { name: 'Change icon' })
  await iconButton.click()
  const dialog = picker(page)
  await expect(dialog).toBeVisible()
  const search = dialog.getByRole('searchbox', { name: 'Search emoji' })
  await expect(search).toBeFocused()
  await page.keyboard.type('tea')
  const teacup = dialog.getByRole('button', { name: 'teacup without handle' })
  await expect(teacup).toBeVisible()
  await savedAfter(page, () => teacup.click())
  await expect(dialog).toBeHidden()
  await expect(iconButton).toHaveText('🍵')
  // Focus is back on the button that opened the picker.
  await expect(iconButton).toBeFocused()

  await reloadApp(page)
  const reloaded = selectedCard(page).getByRole('button', { name: 'Change icon' })
  await expect(reloaded).toHaveText('🍵')

  await reloaded.click()
  await expect(dialog).toBeVisible()
  await savedAfter(page, () => dialog.getByRole('button', { name: 'Use the default icon' }).click())
  await expect(dialog).toBeHidden()
  await expect(reloaded).toHaveText('')
  // Without an icon there is no default to go back to.
  await reloaded.click()
  await expect(dialog.getByRole('searchbox', { name: 'Search emoji' })).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Use the default icon' })).toHaveCount(0)
})

test('the picker works from the keyboard: arrows move, Enter picks, Esc closes', async ({
  page,
}) => {
  await openApp(page)
  const iconButton = selectedCard(page).getByRole('button', { name: 'Change icon' })
  await iconButton.press('Enter')
  const dialog = picker(page)
  await expect(dialog.getByRole('searchbox', { name: 'Search emoji' })).toBeFocused()

  await page.keyboard.type('tea')
  const results = dialog.getByRole('group', { name: 'Search results' }).getByRole('button')
  // Only one result is in the tab order.
  await expect(results.first()).toHaveAttribute('tabindex', '0')
  await expect(results.nth(1)).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('ArrowDown')
  await expect(results.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(results.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(results.first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  const second = (await results.nth(1).textContent()) ?? ''
  expect(second).not.toBe('')
  // Keys pressed in the picker never reach the app: Enter picks, it does not start the timer.
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(iconButton).toHaveText(second)
  await expect(selectedCard(page)).toHaveAttribute('data-phase', 'idle')

  // ArrowUp from the first row goes back to the search; typing there filters again.
  await iconButton.press('Enter')
  const search = dialog.getByRole('searchbox', { name: 'Search emoji' })
  await expect(search).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(search).not.toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(search).toBeFocused()

  // Esc closes without a change.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(iconButton).toHaveText(second)
  await expect(iconButton).toBeFocused()
})
