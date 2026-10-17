/**
 * Startup (spec › Persistence and instances): the saved theme and language are on the page before
 * the app shows anything, so a dark theme on a light system, or Chinese in an English browser,
 * never flashes the wrong one first.
 */
import type { Page } from '@playwright/test'

import { appMounted, cardCells, expect, openApp, openSettings, test } from './support'

test.use({ colorScheme: 'light' })

/** The same choice as playwright.config.ts: preview in CI, dev locally, unless E2E_SERVER says. */
const server = process.env.E2E_SERVER ?? (process.env.CI ? 'preview' : 'dev')

/** What the page looked like at one moment of startup. */
interface Look {
  lang: string
  theme: string | null
  background: string
  mounted: boolean
  text: string
}

/** What a recording page saw: at its first animation frame and when the app first mounted. */
interface StartupLog {
  firstFrame: Look | null
  mount: Look | null
}

/**
 * Records, from before any page script runs, how the page looks at its first animation frame
 * (the first one it could paint) and the moment the app first puts content into `#app`.
 */
const RECORD_STARTUP = `
(() => {
  const log = { firstFrame: null, mount: null };
  window.__startup = log;
  const look = () => {
    const app = document.getElementById('app');
    return {
      lang: document.documentElement.lang,
      theme: document.documentElement.getAttribute('data-theme'),
      background: document.body ? getComputedStyle(document.body).backgroundColor : '',
      mounted: Boolean(app && app.firstElementChild),
      text: app ? app.textContent : '',
    };
  };
  requestAnimationFrame(() => { log.firstFrame = look(); });
  new MutationObserver((_, observer) => {
    const app = document.getElementById('app');
    if (app && app.firstElementChild) {
      log.mount = look();
      observer.disconnect();
    }
  }).observe(document, { childList: true, subtree: true });
})();
`

/** The relative luminance (0–1) of a CSS `rgb()` color. */
function luminance(color: string): number {
  const [r = 0, g = 0, b = 0] = (color.match(/[\d.]+/g) ?? []).map(Number)
  const linear = (c: number): number => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function startupLog(page: Page): Promise<StartupLog> {
  return page.evaluate(() => (window as unknown as { __startup: StartupLog }).__startup)
}

test('a saved dark theme and Chinese are applied before the app shows', async ({
  page,
  context,
}) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Appearance')
  await dialog
    .getByRole('radiogroup', { name: 'Theme' })
    .getByRole('radio', { name: 'Dark' })
    .check()
  await dialog.getByLabel('Language', { exact: true }).selectOption('zh-TW')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW')
  await page.keyboard.press('Escape')
  // Device settings are saved in localStorage.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('timer-app-device') ?? ''))
    .toMatch(/(?=.*"dark")(?=.*"zh-TW")/)
  await page.close()

  const fresh = await context.newPage()
  await fresh.addInitScript(RECORD_STARTUP)
  await fresh.goto('/', { waitUntil: 'domcontentloaded' })
  // The page as the browser can first show it, before the app has mounted.
  await fresh.screenshot({ path: test.info().outputPath('domcontentloaded.png') })
  const early = await fresh.evaluate(() => ({
    lang: document.documentElement.lang,
    theme: document.documentElement.getAttribute('data-theme'),
    background: getComputedStyle(document.body).backgroundColor,
  }))
  expect(early.lang).toBe('zh-TW')
  expect(early.theme).toBe('dark')
  expect(luminance(early.background)).toBeLessThan(0.1)

  await appMounted(fresh)
  const log = await startupLog(fresh)
  // The app's first content is already dark and in Chinese.
  expect(log.mount).toMatchObject({ lang: 'zh-TW', theme: 'dark' })
  expect(luminance(log.mount?.background ?? '')).toBeLessThan(0.1)
  expect(log.mount?.text).toContain('開始')
  expect(log.mount?.text).not.toContain('Start')
  // No frame was painted light before that. The browser can paint once before the app's script
  // runs; index.html puts the saved mode on the page for it. (Only the production build has its
  // CSS then: the dev server injects the stylesheet from JS, so its first frame is unstyled.)
  if (server === 'preview' && log.firstFrame !== null) {
    expect(log.firstFrame.theme).toBe('dark')
    expect(luminance(log.firstFrame.background)).toBeLessThan(0.1)
    // That frame has no text yet, so its language cannot show either.
    expect(log.firstFrame.text.trim()).toBe('')
  }
  await fresh.screenshot({ path: test.info().outputPath('mounted.png') })
})

test.describe('when storage misbehaves, the app still starts, in memory', () => {
  /** Console warnings of `page`, as they come. */
  function warnings(page: Page): string[] {
    const seen: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'warning') seen.push(message.text())
    })
    return seen
  }

  test('a page that may not use IndexedDB at all', async ({ page }) => {
    const seen = warnings(page)
    // Sandboxed and opaque origins throw from the getter itself.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get() {
          throw new DOMException('Access is denied for this document.', 'SecurityError')
        },
      })
    })
    await openApp(page)
    expect(seen.some((text) => text.includes('IndexedDB is unavailable'))).toBe(true)
  })

  test('an IndexedDB that never answers', async ({ page }) => {
    const seen = warnings(page)
    await page.addInitScript(() => {
      IDBFactory.prototype.open = function () {
        return {} as IDBOpenDBRequest
      }
    })
    await page.goto('/')
    await expect(cardCells(page)).toHaveCount(1, { timeout: 10_000 })
    expect(seen.some((text) => text.includes('IndexedDB did not answer'))).toBe(true)
  })
})
