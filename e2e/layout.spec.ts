import type { Page } from '@playwright/test'

import { cardCells, expect, openApp, test } from './support'

/** The left edges of the cards, rounded, in grid order. */
function cardLefts(page: Page): Promise<number[]> {
  return cardCells(page).evaluateAll((cells) =>
    cells.map((cell) => Math.round(cell.getBoundingClientRect().left)),
  )
}

/** Whether the page scrolls sideways. */
function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  )
}

/** Adds timers with the N shortcut until there are `count` cards. */
async function addCards(page: Page, count: number): Promise<void> {
  for (let n = 1; n < count; n++) await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(count)
}

test.describe('phone, 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('stacks cards in one column without horizontal scrolling', async ({ page }) => {
    await openApp(page)
    await addCards(page, 3)
    await expect.poll(async () => new Set(await cardLefts(page)).size).toBe(1)
    expect(await scrollsSideways(page)).toBe(false)
    const box = await cardCells(page).first().boundingBox()
    expect(box?.width).toBeLessThanOrEqual(390)
    // Action bar labels collapse to icons; the buttons keep their names.
    await expect(page.getByRole('button', { name: 'New timer' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New stopwatch' })).toBeVisible()
  })
})

test.describe('laptop, 1280×800', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('shows three cards in two or more columns', async ({ page }) => {
    await openApp(page)
    await addCards(page, 3)
    await expect.poll(async () => new Set(await cardLefts(page)).size).toBeGreaterThanOrEqual(2)
    expect(await scrollsSideways(page)).toBe(false)
  })

  test('floats the action bar at the bottom right', async ({ page }) => {
    await openApp(page)
    const bar = await page.getByRole('group', { name: 'Card actions' }).boundingBox()
    expect(bar).not.toBeNull()
    if (!bar) return
    expect(1280 - (bar.x + bar.width)).toBeLessThanOrEqual(32)
    expect(800 - (bar.y + bar.height)).toBeLessThanOrEqual(32)
  })

  test('keeps cards at a 3:2 shape', async ({ page }) => {
    await openApp(page)
    const box = await cardCells(page).first().boundingBox()
    expect(box).not.toBeNull()
    if (box) expect(box.width / box.height).toBeCloseTo(1.5, 1)
  })
})

test.describe('4K, 3840×2160', () => {
  test.use({ viewport: { width: 3840, height: 2160 } })

  test('a lone card is at most 48rem wide and centered', async ({ page }) => {
    await openApp(page)
    const maxWidth = await page.evaluate(
      () => 48 * Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    )
    const box = await cardCells(page).first().boundingBox()
    expect(box).not.toBeNull()
    if (!box) return
    expect(box.width).toBeLessThanOrEqual(maxWidth + 0.5)
    expect(box.width).toBeGreaterThan(maxWidth * 0.9)
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth)
    expect(Math.abs(box.x + box.width / 2 - viewportWidth / 2)).toBeLessThanOrEqual(1)
  })
})

test('light and dark themes follow the OS and data-theme overrides it', async ({
  page,
}, testInfo) => {
  /** The page background, as computed. */
  const background = (): Promise<string> =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  await page.emulateMedia({ colorScheme: 'light' })
  await openApp(page)
  await page.keyboard.press('Shift+N')
  await expect(cardCells(page)).toHaveCount(2)
  const light = await background()
  const lightShot = testInfo.outputPath('grid-light.png')
  await page.screenshot({ path: lightShot, animations: 'disabled' })
  await testInfo.attach('grid-light', { path: lightShot, contentType: 'image/png' })

  await page.emulateMedia({ colorScheme: 'dark' })
  await expect.poll(background).not.toBe(light)
  const dark = await background()
  const darkShot = testInfo.outputPath('grid-dark.png')
  await page.screenshot({ path: darkShot, animations: 'disabled' })
  await testInfo.attach('grid-dark', { path: darkShot, contentType: 'image/png' })

  // The settings override (M3) sets data-theme on <html>; it wins over the OS preference.
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await expect.poll(background).toBe(light)
  await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await expect.poll(background).toBe(dark)
})
