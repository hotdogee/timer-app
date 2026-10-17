import { expect, test } from '@playwright/test'

test('loads the app with its title and generated theme', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle('Timer App')
  // The Material 3 theme is injected before the app mounts.
  await expect(page.locator('style#theme')).toHaveCount(1)
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--md-sys-color-surface').trim(),
  )
  expect(surface).toMatch(/^#[0-9a-f]{6}$/)
})
