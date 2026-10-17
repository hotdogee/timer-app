/**
 * Languages (spec › Internationalization): the UI follows the browser's language (Japanese and
 * Traditional Chinese variants map to the launch locales), names new cards and the first-run
 * presets in it, and switches live from Settings without a reload, keeping running timers. The
 * three message files having the same keys is a unit test (src/i18n/catalog.test.ts); here one
 * visible string per locale is enough.
 */
import { cardNamed, digitsOf, expect, openApp, reloadApp, selectedCard, test } from './support'

test.describe('a Japanese browser', () => {
  test.use({ locale: 'ja-JP' })

  test('shows the app in Japanese', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja')
    await expect(page.getByRole('grid', { name: 'カード' })).toBeVisible()
    const card = selectedCard(page)
    await expect(card).toHaveAccessibleName('タイマー')
    await expect(card.getByRole('button', { name: '開始' })).toBeVisible()

    // Japanese UI fonts come before system-ui, which on a Chinese Windows would draw the kanji in
    // their Chinese forms.
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    expect(family).toContain('Yu Gothic UI')
    expect(family.indexOf('Yu Gothic UI')).toBeLessThan(family.indexOf('system-ui'))

    // The first-run presets are named in Japanese too.
    await page.keyboard.press('p')
    const menu = page.getByRole('menu', { name: '新しいタイマー' })
    await expect(menu.getByRole('menuitem')).toHaveText([
      /タイマー\s*5:00/,
      /お茶\s*3:00/,
      /ポモドーロ\s*25:00/,
      /休憩\s*5:00/,
      /ゆで卵\s*7:00/,
    ])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()

    await page.keyboard.press('?')
    const help = page.getByRole('dialog', { name: 'ショートカットキー' })
    await expect(help).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(help).toBeHidden()

    await page.keyboard.press('n')
    await expect(selectedCard(page)).toHaveAccessibleName('タイマー 2')
  })
})

test.describe('a Hong Kong Chinese browser', () => {
  test.use({ locale: 'zh-HK' })

  test('gets Traditional Chinese', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
    await expect(selectedCard(page)).toHaveAccessibleName('計時器')
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    expect(family).toContain('Microsoft JhengHei UI')
    expect(family.indexOf('Microsoft JhengHei UI')).toBeLessThan(family.indexOf('system-ui'))
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: '鍵盤快速鍵' })).toBeVisible()
  })
})

test('switching to 繁體中文 in Settings applies live, keeps timers running and persists', async ({
  page,
}) => {
  await openApp(page)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  const card = cardNamed(page, 'Timer')
  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(card.getByRole('button', { name: 'Pause' })).toBeVisible()
  // Survives only as long as the page is not reloaded.
  await page.evaluate(() => {
    ;(window as unknown as { notReloaded: boolean }).notReloaded = true
  })

  await page.keyboard.press('ControlOrMeta+,')
  const english = page.getByRole('dialog', { name: 'Settings' })
  await english.getByRole('tab', { name: 'Appearance' }).click()
  const language = english.getByLabel('Language', { exact: true })
  await expect(language).toHaveValue('auto')
  await language.selectOption('zh-TW')

  // The open dialog re-renders in place.
  const chinese = page.getByRole('dialog', { name: '設定' })
  await expect(chinese).toBeVisible()
  await expect(chinese.getByRole('tab', { name: '外觀' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  await page.keyboard.press('Escape')
  await expect(chinese).toBeHidden()

  // The cards too, and the running timer kept running: the page did not reload.
  await expect(page.getByRole('grid', { name: '卡片' })).toBeVisible()
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(card.getByRole('button', { name: '暫停' })).toBeVisible()
  expect(
    await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
  ).toBe(true)
  // A saved name stays as it is; new cards get the new default name.
  await page.keyboard.press('n')
  await expect(selectedCard(page)).toHaveAccessibleName('計時器')

  // The language is saved on this device.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('timer-app-device') ?? ''))
    .toContain('zh-TW')
  await reloadApp(page)
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(card.getByRole('button', { name: '暫停' })).toBeVisible()
  await expect(digitsOf(card)).toHaveText(/^4:\d\d$/)
})
