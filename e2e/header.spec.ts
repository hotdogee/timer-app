/**
 * The card header's alignment: the icon mirrors the right-hand buttons (its box on the card's
 * padding edge as theirs, its glyph as far in), the name's text sits where the rename field's
 * text does, and edit mode puts the drag handle in the icon's box.
 */
import type { Locator, Page } from '@playwright/test'

import { expect, openApp, selectedCard, test } from './support'

// Motion off, so no card is mid-animation while it is measured.
test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' })

/** Layout rounds to fractions of a pixel; a position within this is the same place. */
const TOLERANCE = 0.6

function expectNear(actual: number, expected: number, what: string): void {
  expect(
    Math.abs(actual - expected),
    `${what}: ${actual.toFixed(2)} vs ${expected.toFixed(2)}`,
  ).toBeLessThanOrEqual(TOLERANCE)
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The locator's border box relative to its card's: focus (the field's, or the card's again after
 * Esc) can scroll the page between two measurements, and the card's own box is what matters.
 */
function boxOf(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const origin = (element.closest('[role="gridcell"]') ?? document.body).getBoundingClientRect()
    return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
  })
}

/**
 * The app with its card, once the web font is in: swapped in after the first paint, it would move
 * the text by a pixel between two measurements.
 */
async function openCard(page: Page): Promise<Locator> {
  await openApp(page)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return selectedCard(page)
}

/** The card's name as a button, inside its heading. */
function nameButton(card: Locator): Locator {
  return card.getByRole('heading', { name: 'Timer' }).getByRole('button')
}

/** Where the name button's text is, relative to the card (as boxOf): a range over its text. */
function nameTextRect(card: Locator): Promise<{ left: number; top: number }> {
  return nameButton(card).evaluate((button) => {
    const range = document.createRange()
    range.selectNodeContents(button.querySelector('.name-text') ?? button)
    const { left, top } = range.getBoundingClientRect()
    const origin = (button.closest('[role="gridcell"]') ?? document.body).getBoundingClientRect()
    return { left: left - origin.left, top: top - origin.top }
  })
}

test('the header’s icons line up with the card’s buttons', async ({ page }) => {
  const card = await openCard(page)
  const icon = card.getByRole('button', { name: 'Change icon' })
  const lastAction = card.locator('header .actions button').last()
  const start = card.getByRole('button', { name: 'Start', exact: true })
  const [iconBox, iconGlyph, actionBox, actionGlyph, startBox] = await Promise.all([
    boxOf(icon),
    boxOf(icon.locator('svg')),
    boxOf(lastAction),
    boxOf(lastAction.locator('svg')),
    boxOf(start),
  ])

  expectNear(iconBox.x, startBox.x, 'the icon button’s left edge, Start’s')
  expectNear(
    actionBox.x + actionBox.width,
    startBox.x + startBox.width,
    'the last header button’s right edge, Start’s',
  )
  expectNear(
    iconGlyph.x - startBox.x,
    startBox.x + startBox.width - (actionGlyph.x + actionGlyph.width),
    'the left glyph’s inset, the right glyph’s',
  )
})

test('the name does not move when renamed', async ({ page }) => {
  const card = await openCard(page)
  const name = nameButton(card)
  const text = await nameTextRect(card)
  const nameBox = await boxOf(name)

  await name.click()
  const field = card.getByRole('textbox', { name: 'Card name' })
  await expect(field).toBeFocused()
  const fieldTextLeft = await field.evaluate((input) => {
    const rect = input.getBoundingClientRect()
    const origin = (input.closest('[role="gridcell"]') ?? document.body).getBoundingClientRect()
    return (
      rect.left -
      origin.left +
      input.clientLeft +
      Number.parseFloat(getComputedStyle(input).paddingLeft)
    )
  })
  expectNear(fieldTextLeft, text.left, 'the field’s text start, the name’s')
  // Both are 44px boxes centered in the header row.
  expectNear((await boxOf(field)).y, nameBox.y, 'the field’s top, the name button’s')

  await page.keyboard.press('Escape')
  await expect(field).toHaveCount(0)
  const back = await nameTextRect(card)
  expectNear(back.left, text.left, 'the name’s text start after Esc')
  expectNear(back.top, text.top, 'the name’s text top after Esc')
})

test('edit mode puts the drag handle where the icon was', async ({ page }) => {
  const card = await openCard(page)
  const icon = card.getByRole('button', { name: 'Change icon' })
  const [iconBox, nameBox] = await Promise.all([boxOf(icon), boxOf(nameButton(card))])

  await page.keyboard.press('e')
  const handle = card.getByRole('button', { name: /^Move / })
  await expect(handle).toBeVisible()
  await expect(icon).toHaveCount(0)
  const handleBox = await boxOf(handle)
  expectNear(handleBox.x, iconBox.x, 'the handle’s left edge, the icon’s')
  expectNear(handleBox.y, iconBox.y, 'the handle’s top, the icon’s')
  const fieldBox = await boxOf(card.getByRole('textbox', { name: 'Card name' }))
  expectNear(fieldBox.x, nameBox.x, 'the name field’s left edge, the name button’s')

  // Esc leaves edit mode: the icon is back.
  await page.keyboard.press('Escape')
  await expect(handle).toHaveCount(0)
  await expect(icon).toBeVisible()
})
