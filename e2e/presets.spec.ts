/**
 * Presets are data (spec › Presets): one added in Settings › Presets shows up in the "+ Timer"
 * menu and the command palette and creates a timer with its name and duration; reordering and
 * deleting it there change both lists, and presets survive a reload.
 */
import type { Locator, Page } from '@playwright/test'

import {
  closeSettings,
  digitsOf,
  expect,
  openApp,
  openSettings,
  reloadApp,
  savedAfter,
  selectedCard,
  test,
} from './support'

/** The "+ Timer" menu's items, opened with its button. */
async function timerMenuItems(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'New timer', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'New timer' })
  await expect(menu).toBeVisible()
  return menu.getByRole('menuitem')
}

/** The names in Settings › Presets, in order. */
function presetNames(dialog: Locator): Promise<string[]> {
  return dialog
    .getByRole('textbox', { name: 'Preset name' })
    .evaluateAll((fields) => fields.map((field) => (field as HTMLInputElement).value))
}

/** The command palette's options for `query`. */
async function paletteOptions(page: Page, query: string): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.keyboard.type(query)
  return palette.getByRole('listbox', { name: 'Commands' }).getByRole('option')
}

test('a preset added in settings creates timers from the menu and the palette', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Presets')
  await expect(dialog.getByRole('textbox', { name: 'Preset name' })).toHaveCount(4)

  // Add: a new row at the end, its name selected for typing.
  await dialog.getByRole('button', { name: 'Add preset' }).click()
  const names = dialog.getByRole('textbox', { name: 'Preset name' })
  await expect(names).toHaveCount(5)
  await expect(names.last()).toBeFocused()
  await expect(names.last()).toHaveValue('New preset')
  await page.keyboard.type('Soup')
  await page.keyboard.press('Enter')
  const duration = dialog.getByRole('textbox', { name: 'Duration of Soup' })
  await duration.click()
  await page.keyboard.type('1230')
  await expect(duration).toHaveValue('00:12:30')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect(duration).toHaveValue('12:30')
  await closeSettings(page)

  const items = await timerMenuItems(page)
  await expect(items).toHaveText([
    /Timer\s*5:00/,
    /Tea\s*3:00/,
    /Pomodoro\s*25:00/,
    /Break\s*5:00/,
    /Eggs\s*7:00/,
    /Soup\s*12:30/,
  ])
  await items.last().click()
  await expect(selectedCard(page)).toHaveAccessibleName('Soup')
  await expect(digitsOf(selectedCard(page))).toHaveText('00:12:30')

  const options = await paletteOptions(page, 'soup')
  await expect(options.first()).toContainText('New timer: Soup')
  await expect(options.first()).toContainText('12:30')
  await page.keyboard.press('Enter')
  await expect(selectedCard(page)).toHaveAccessibleName('Soup 2')
  await expect(digitsOf(selectedCard(page))).toHaveText('00:12:30')
})

test('moving and deleting presets changes the menu, and presets survive a reload', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Presets')
  await dialog.getByRole('button', { name: 'Move Eggs up' }).click()
  await dialog.getByRole('button', { name: 'Move Eggs up' }).click()
  await expect.poll(() => presetNames(dialog)).toEqual(['Tea', 'Eggs', 'Pomodoro', 'Break'])
  await savedAfter(page, async () => {
    await dialog.getByRole('button', { name: 'Delete Pomodoro' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Preset name' })).toHaveCount(3)
  })
  await closeSettings(page)

  let items = await timerMenuItems(page)
  await expect(items).toHaveText([/Timer\s*5:00/, /Tea\s*3:00/, /Eggs\s*7:00/, /Break\s*5:00/])
  await page.keyboard.press('Escape')
  await expect(items).toHaveCount(0)
  const options = await paletteOptions(page, 'new timer:')
  await expect(options).toHaveText([/New timer: Tea/, /New timer: Eggs/, /New timer: Break/])
  await page.keyboard.press('Escape')
  await expect(options).toHaveCount(0)

  await reloadApp(page)
  items = await timerMenuItems(page)
  await expect(items).toHaveText([/Timer\s*5:00/, /Tea\s*3:00/, /Eggs\s*7:00/, /Break\s*5:00/])
})
