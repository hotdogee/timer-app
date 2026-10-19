/**
 * The settings dialog (spec › Settings): how it opens and closes, every appearance setting acting
 * on the page, the behavior settings acting on the cards, confirm before delete, rebinding a
 * shortcut, and settings surviving a reload.
 */
import type { Locator, Page } from '@playwright/test'

import {
  cardCells,
  closeSettings,
  digitsOf,
  expect,
  openApp,
  openSettings,
  openWithPausedClock,
  reloadApp,
  savedAfter,
  selectedCard,
  settingsDialog,
  snackbar,
  test,
} from './support'

/** The relative luminance (0–1) of the page background. */
function pageLuminance(page: Page): Promise<number> {
  return page.evaluate(() => {
    const color = getComputedStyle(document.body).backgroundColor
    const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).map(Number)
    const linear = (c: number): number => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  })
}

/** A computed style property of the first element `locator` matches. */
function computed(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  )
}

/** The rendered size of the selected card's digits, in pixels. */
async function digitSize(page: Page): Promise<number> {
  return parseFloat(await computed(digitsOf(selectedCard(page)), 'font-size'))
}

test('opens with Mod+, the ⚙ button and the palette; Esc closes it and focus returns', async ({
  page,
}) => {
  await openApp(page)
  const dialog = settingsDialog(page)

  await page.keyboard.press('ControlOrMeta+,')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'Appearance' })).toBeFocused()
  // Keys typed while it is open do not reach the cards.
  await page.keyboard.press('n')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(cardCells(page)).toHaveCount(1)

  // The shortcut toggles it.
  await page.keyboard.press('ControlOrMeta+,')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('ControlOrMeta+,')
  await expect(dialog).toBeHidden()

  // The ⚙ button opens it, and focus returns there on close; it reopens on the last section.
  const gear = page.getByRole('button', { name: 'Settings', exact: true })
  await gear.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('tab', { name: 'Behavior' }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(gear).toBeFocused()
  await gear.click()
  await expect(dialog.getByRole('tab', { name: 'Behavior' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(dialog.getByRole('tab', { name: 'Behavior' })).toBeFocused()
  await closeSettings(page)
  await expect(gear).toBeFocused()

  // The palette's "Settings…" command.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await page.keyboard.type('settings')
  await expect(palette.getByRole('option').first()).toContainText('Settings…')
  await page.keyboard.press('Enter')
  await expect(palette).toBeHidden()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('theme mode forces light or dark, and Reset follows the system again', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openApp(page)
  const html = page.locator('html')
  expect(await pageLuminance(page)).toBeGreaterThan(0.6)

  const dialog = await openSettings(page, 'Appearance')
  const theme = dialog.getByRole('radiogroup', { name: 'Theme' })
  await expect(theme.getByRole('radio', { name: 'System' })).toBeChecked()
  await theme.getByRole('radio', { name: 'Dark' }).check()
  await expect(html).toHaveAttribute('data-theme', 'dark')
  expect(await pageLuminance(page)).toBeLessThan(0.1)

  await page.emulateMedia({ colorScheme: 'dark' })
  await theme.getByRole('radio', { name: 'Light' }).check()
  await expect(html).toHaveAttribute('data-theme', 'light')
  expect(await pageLuminance(page)).toBeGreaterThan(0.6)

  await dialog.getByRole('button', { name: 'Reset Appearance settings' }).click()
  await expect(theme.getByRole('radio', { name: 'System' })).toBeChecked()
  await expect(html).not.toHaveAttribute('data-theme')
  // The system is dark now.
  expect(await pageLuminance(page)).toBeLessThan(0.1)
})

test('font, density and digit size change the cards', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page)
  const digits = digitsOf(selectedCard(page))
  const row = page.getByRole('grid', { name: 'Cards' }).getByRole('row')
  expect(await computed(digits, 'font-family')).toContain('Roboto Flex')
  const comfortableGap = parseFloat(await computed(row, 'column-gap'))

  const dialog = await openSettings(page, 'Appearance')
  await dialog.getByLabel('Font', { exact: true }).selectOption('inter')
  await dialog
    .getByRole('radiogroup', { name: 'Card density' })
    .getByRole('radio', { name: 'Compact' })
    .check()
  const digitScale = dialog.getByRole('slider', { name: 'Digit size' })
  await digitScale.focus()
  await page.keyboard.press('End')
  await expect(digitScale).toHaveValue('1.5')
  await expect(digitScale).toHaveAttribute('aria-valuetext', '150%')
  await closeSettings(page)

  expect(await computed(digits, 'font-family')).toMatch(/^"?Inter/)
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
  expect(parseFloat(await computed(row, 'column-gap'))).toBeLessThan(comfortableGap)
  // The digits scale with the setting: 0.75 to 1.5 is twice the size, in the same layout (an idle
  // card: its fixed form fits the face, not the ring, so the whole range shows there too).
  await openSettings(page)
  await digitScale.focus()
  await page.keyboard.press('Home')
  await expect(digitScale).toHaveValue('0.75')
  const small = await digitSize(page)
  await page.keyboard.press('End')
  const large = await digitSize(page)
  expect(large / small).toBeCloseTo(2, 1)
})

test('fixed time style and quick-add values change the timer card', async ({ page }) => {
  // On a paused timer: an idle one shows the fixed form whatever the style.
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await page.keyboard.press('Enter')
  await page.clock.runFor(10_000)
  await page.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'paused')
  await expect(digitsOf(card)).toHaveText('4:50')
  await expect(card.getByRole('button', { name: '+0:30' })).toBeVisible()

  const dialog = await openSettings(page, 'Behavior')
  await dialog
    .getByRole('radiogroup', { name: 'Time format' })
    .getByRole('radio', { name: 'Fixed' })
    .check()
  // Quick-add durations are typed like a card's: 15 is 0:15.
  const chip = dialog.getByRole('textbox', { name: 'Chip 1' })
  await chip.click()
  await page.keyboard.type('15')
  await expect(chip).toHaveValue('00:00:15')
  await page.keyboard.press('Enter')
  // Leaving the field keeps it, shown in the chosen style.
  await page.keyboard.press('Tab')
  await expect(chip).toHaveValue('00:00:15')
  await expect(dialog.getByRole('textbox', { name: 'Chip 2' })).toBeFocused()
  await closeSettings(page)

  await expect(digitsOf(card)).toHaveText('00:04:50')
  await expect(card.getByRole('button', { name: '+0:15' })).toBeVisible()
  await expect(card.getByRole('button', { name: '+0:30' })).toHaveCount(0)
  await card.getByRole('button', { name: '+0:15' }).click()
  await expect(digitsOf(card)).toHaveText('00:05:05')
})

test.describe('clock format', () => {
  test.use({ timezoneId: 'UTC' })

  test('24-hour changes the end-time chip of a running timer', async ({ page }) => {
    const pausedAt = await openWithPausedClock(page)
    const card = selectedCard(page)
    await page.keyboard.press('Enter')
    const endTime = card.getByTestId('end-time')
    const end = new Date(pausedAt + 5 * 60_000)
    const hours = end.getUTCHours()
    const minutes = String(end.getUTCMinutes()).padStart(2, '0')
    // Automatic follows the language: 12-hour for en-US.
    await expect(endTime).toHaveText(
      new RegExp(`${String(hours % 12 || 12)}:${minutes}\\s(AM|PM)$`),
    )

    const dialog = await openSettings(page, 'Behavior')
    const clock = dialog.getByRole('radiogroup', { name: 'Clock format' })
    await clock.getByRole('radio', { name: '24-hour' }).check()
    await closeSettings(page)
    await expect(endTime).toHaveText(new RegExp(`${String(hours).padStart(2, '0')}:${minutes}$`))
  })
})

test('sound, volume, loop and auto-stop are kept across a reload', async ({ page }) => {
  await openApp(page)
  let dialog = await openSettings(page, 'Behavior')
  const sound = dialog.getByLabel('Sound', { exact: true })
  const volume = dialog.getByRole('slider', { name: 'Volume' })
  const loop = dialog.getByRole('switch', { name: 'Loop sound' })
  const autoStop = dialog.getByLabel('Auto-stop', { exact: true })
  await expect(sound).toHaveValue('chime')
  await expect(volume).toHaveValue('0.8')
  await expect(loop).toHaveAttribute('aria-checked', 'true')
  await expect(autoStop).toHaveValue('0')

  await sound.selectOption('bell')
  await volume.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(volume).toHaveValue('0.75')
  await loop.click()
  await expect(loop).toHaveAttribute('aria-checked', 'false')
  await savedAfter(page, async () => {
    await autoStop.selectOption({ label: '5 minutes' })
    await expect(autoStop).toHaveValue('5')
  })

  await reloadApp(page)
  dialog = await openSettings(page, 'Behavior')
  await expect(sound).toHaveValue('bell')
  await expect(volume).toHaveValue('0.75')
  await expect(volume).toHaveAttribute('aria-valuetext', '75%')
  await expect(loop).toHaveAttribute('aria-checked', 'false')
  await expect(autoStop).toHaveValue('5')

  // Reset restores the behavior defaults.
  await dialog.getByRole('button', { name: 'Reset Behavior settings' }).click()
  await expect(sound).toHaveValue('chime')
  await expect(volume).toHaveValue('0.8')
  await expect(loop).toHaveAttribute('aria-checked', 'true')
  await expect(autoStop).toHaveValue('0')
})

test('confirm before delete asks first: Esc keeps the card, Enter deletes it', async ({ page }) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Behavior')
  const confirm = dialog.getByRole('switch', { name: 'Confirm before delete' })
  await expect(confirm).toHaveAttribute('aria-checked', 'false')
  await confirm.click()
  await expect(confirm).toHaveAttribute('aria-checked', 'true')
  await closeSettings(page)

  const question = page.getByRole('alertdialog', { name: 'Delete Timer?' })
  await page.keyboard.press('Delete')
  await expect(question).toBeVisible()
  await expect(question.getByRole('button', { name: 'Delete' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(question).toBeHidden()
  await expect(cardCells(page)).toHaveCount(1)

  await page.keyboard.press('Delete')
  await expect(question).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(question).toBeHidden()
  await expect(cardCells(page)).toHaveCount(0)
  // The undo snackbar still follows.
  await expect(snackbar(page)).toContainText('Deleted Timer')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(cardCells(page)).toHaveCount(1)
})

test('a shortcut can be rebound, moved from another action, and reset', async ({ page }) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Keyboard')
  const newTimer = dialog.locator('[data-action="newTimer"]')
  const newStopwatch = dialog.locator('[data-action="newStopwatch"]')
  await expect(newTimer.locator('kbd')).toHaveText(['N'])

  // A reserved key is refused; then Shift+T takes N's place.
  await dialog.getByRole('button', { name: 'Change the shortcut for New timer' }).click()
  const recorder = dialog.getByRole('textbox', { name: 'Change the shortcut for New timer' })
  await expect(recorder).toBeFocused()
  await page.keyboard.press('5')
  await expect(dialog.getByRole('alert').filter({ hasText: "can't be used" })).toHaveText(
    "5 can't be used as a shortcut",
  )
  await page.keyboard.press('Shift+T')
  await expect(newTimer.locator('kbd')).toHaveText(['Shift+T'])
  await closeSettings(page)

  await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(1)
  await page.keyboard.press('Shift+T')
  await expect(cardCells(page)).toHaveCount(2)
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 2')

  // Recording a key that another action has asks before moving it.
  await openSettings(page)
  await dialog.getByRole('button', { name: 'Change the shortcut for New stopwatch' }).click()
  await page.keyboard.press('Shift+T')
  await expect(dialog.getByText('Shift+T is already used for New timer')).toBeVisible()
  await dialog.getByRole('button', { name: 'Move here' }).click()
  await expect(newStopwatch.locator('kbd')).toHaveText(['Shift+T'])
  await expect(newTimer).toContainText('None')
  await closeSettings(page)
  await page.keyboard.press('Shift+T')
  await expect(cardCells(page)).toHaveCount(3)
  await expect(selectedCard(page)).toHaveAttribute('data-kind', 'stopwatch')

  // The cheat sheet shows the new key.
  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toBeVisible()
  await expect(help.getByText('Shift+T')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()

  // Reset all puts every default back.
  await openSettings(page)
  await dialog.getByRole('button', { name: 'Reset all shortcuts' }).click()
  await expect(newTimer.locator('kbd')).toHaveText(['N'])
  await expect(newStopwatch.locator('kbd')).toHaveText(['Shift+N'])
  await closeSettings(page)
  await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(4)
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 3')
})

test('settings survive a reload', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await openApp(page)
  const dialog = await openSettings(page, 'Appearance')
  await dialog
    .getByRole('radiogroup', { name: 'Theme' })
    .getByRole('radio', { name: 'Dark' })
    .check()
  await dialog.getByRole('tab', { name: 'Behavior' }).click()
  await savedAfter(page, async () => {
    await dialog
      .getByRole('radiogroup', { name: 'Time format' })
      .getByRole('radio', { name: 'Fixed' })
      .check()
  })
  await closeSettings(page)

  await reloadApp(page)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await pageLuminance(page)).toBeLessThan(0.1)
  await openSettings(page, 'Appearance')
  await expect(
    dialog.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }),
  ).toBeChecked()
  // The card's idle digits are fixed whatever the style, so the setting itself is checked.
  await dialog.getByRole('tab', { name: 'Behavior' }).click()
  await expect(
    dialog.getByRole('radiogroup', { name: 'Time format' }).getByRole('radio', { name: 'Fixed' }),
  ).toBeChecked()
})

test('a key pressed the moment a dialog closes acts on the page', async ({ page }) => {
  await openApp(page)
  // Each opens from the page itself, so focus is still inside the dialog as it closes.
  await page.keyboard.press('?')
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(2)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(3)

  const dialog = settingsDialog(page)
  await page.keyboard.press('ControlOrMeta+,')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+,')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(4)
  await expect(dialog).toBeHidden()
})

test('a shortcut without modifiers types into a text field instead of closing its dialog', async ({
  page,
}) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Keyboard')
  const palette = page.getByRole('dialog', { name: 'Command palette' })

  // The command palette on K: typing a K in its search keeps it open.
  await dialog.getByRole('button', { name: 'Change the shortcut for Command palette' }).click()
  await page.keyboard.press('k')
  await expect(dialog.locator('[data-action="palette"] kbd')).toHaveText(['K'])
  await closeSettings(page)
  await page.keyboard.press('k')
  await expect(palette).toBeVisible()
  await page.keyboard.type('mark')
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('combobox')).toHaveValue('mark')
  await page.keyboard.press('Escape')
  await expect(palette).toBeHidden()

  // Settings on S (rebound last: Mod+, stops opening it then): typing in a preset's name keeps
  // the dialog open, and S anywhere else closes it.
  await openSettings(page, 'Keyboard')
  await dialog.getByRole('button', { name: 'Change the shortcut for Settings' }).click()
  await page.keyboard.press('s')
  await expect(dialog.locator('[data-action="settings"] kbd')).toHaveText(['S'])
  const presets = dialog.getByRole('tab', { name: 'Presets' })
  await presets.click()
  const name = dialog.getByRole('textbox', { name: 'Preset name' }).first()
  await name.fill('')
  await name.pressSequentially('Rooibos')
  await expect(name).toHaveValue('Rooibos')
  await expect(dialog).toBeVisible()
  await presets.focus()
  await page.keyboard.press('s')
  await expect(dialog).toBeHidden()
  await page.keyboard.press('s')
  await expect(dialog).toBeVisible()
})
