/**
 * The mini window (spec › Card header, Mini window) in the browser:
 *
 * - its page, `/mini?card=<id>`, which the desktop app opens in a window of its own: one card,
 *   driven by its keys, in step with the app's tabs through the shared storage;
 * - the web's mini window, a Document Picture-in-Picture window, which the card header's button,
 *   `T` and the palette open. Playwright's Chromium has the API, but its window is not a page the
 *   test can reach, so a stub stands in for it: `requestWindow` opens a popup, an ordinary window
 *   with a document of its own, which is all the app uses. Without the API, the mini window is
 *   hidden everywhere.
 */
import type { Page } from '@playwright/test'

import {
  cardCells,
  cardNamed,
  closeSettings,
  digitsOf,
  expect,
  openApp,
  openSettings,
  selectedCard,
  test,
} from './support'

/**
 * Replaces Document Picture-in-Picture before the app starts: with a stub that opens a popup of
 * the requested size (`popup`), or with nothing (`absent`), as in Firefox and Safari.
 */
async function pictureInPicture(page: Page, mode: 'popup' | 'absent'): Promise<void> {
  await page.addInitScript((mode) => {
    const api =
      mode === 'absent'
        ? undefined
        : {
            requestWindow(options: { width?: number; height?: number } = {}) {
              const size = `width=${String(options.width ?? 320)},height=${String(options.height ?? 200)}`
              const popup = window.open('', '', `popup,${size}`)
              return popup ? Promise.resolve(popup) : Promise.reject(new Error('popup blocked'))
            },
          }
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      get: () => api,
    })
  }, mode)
}

/** The mini card in `page` (the mini window's page or the Picture-in-Picture document). */
function miniCard(page: Page) {
  return page.locator('main.mini')
}

/** The id of the selected card in the app. */
async function selectedId(page: Page): Promise<string> {
  const id = await selectedCard(page).getAttribute('data-card-id')
  expect(id, 'the selected card has an id').not.toBeNull()
  return id ?? ''
}

test('the mini window page shows one card, drives it, and the app follows through the tabs', async ({
  page,
  context,
}) => {
  await openApp(page)
  const id = await selectedId(page)
  const card = selectedCard(page)

  const mini = await context.newPage()
  await mini.goto(`/mini?card=${encodeURIComponent(id)}`)
  const compact = miniCard(mini)
  await expect(compact.getByRole('heading', { name: 'Timer' })).toBeVisible()
  await expect(digitsOf(compact)).toHaveText('5:00')
  await expect(mini).toHaveTitle('Timer – Mini window')
  // No grid, no action bar, no palette: just the card.
  await expect(mini.getByRole('grid')).toHaveCount(0)

  await mini.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(compact).toHaveAttribute('data-phase', 'running')
  await expect(compact.getByRole('button', { name: 'Pause' })).toBeVisible()

  // And the other way: Space in the app pauses it in the mini window.
  await page.keyboard.press('Space')
  await expect(compact).toHaveAttribute('data-phase', 'paused')
  await expect(compact.getByRole('button', { name: 'Resume' })).toBeVisible()

  await mini.keyboard.press('r')
  await expect(card).toHaveAttribute('data-phase', 'idle')
  await expect(digitsOf(compact)).toHaveText('5:00')

  await compact.getByRole('button', { name: '+1:00' }).click()
  // The app's idle card shows the fixed form; the mini window keeps the time style.
  await expect(digitsOf(card)).toHaveText('00:06:00')
  await expect(digitsOf(compact)).toHaveText('6:00')
})

test('the mini window page says when its card is deleted, and follows an undo', async ({
  page,
  context,
}) => {
  await openApp(page)
  const id = await selectedId(page)
  const mini = await context.newPage()
  await mini.goto(`/mini?card=${encodeURIComponent(id)}`)
  const compact = miniCard(mini)
  await expect(digitsOf(compact)).toHaveText('5:00')

  await page.keyboard.press('Delete')
  await expect(cardCells(page)).toHaveCount(0)
  await expect(compact.getByTestId('mini-deleted')).toHaveText('This card was deleted')
  // Said through the page's live region, which a screen reader already follows.
  await expect(compact.getByRole('status')).toHaveText('This card was deleted')
  // The name stays in the header.
  await expect(compact.getByRole('heading', { name: 'Timer' })).toBeVisible()

  // An undo in time brings the card back here too.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(digitsOf(compact)).toHaveText('5:00')

  const missing = await context.newPage()
  await missing.goto('/mini?card=no-such-card')
  await expect(miniCard(missing).getByTestId('mini-deleted')).toHaveText('This card was deleted')
  // A heading still names the window.
  await expect(miniCard(missing).getByRole('heading', { name: 'Mini window' })).toBeVisible()
})

test('the card header, T and the palette open the Picture-in-Picture mini window', async ({
  page,
}) => {
  await pictureInPicture(page, 'popup')
  await openApp(page)
  const card = selectedCard(page)
  const button = card.getByRole('button', { name: 'Mini window' })
  await expect(button).toBeVisible()

  const opened = page.waitForEvent('popup')
  await button.click()
  const pip = await opened
  const compact = miniCard(pip)
  await expect(compact.getByRole('heading', { name: 'Timer' })).toBeVisible()
  await expect(digitsOf(compact)).toHaveText('5:00')
  // The app's look came along: its theme and language.
  await expect(pip.locator('html')).toHaveAttribute('lang', 'en')
  expect(await pip.locator('style#theme').count()).toBe(1)

  // The Picture-in-Picture window acts on the app's own state.
  await pip.keyboard.press('Space')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await card.getByRole('button', { name: 'Pause' }).click()
  await expect(compact).toHaveAttribute('data-phase', 'paused')

  // T on another card switches the open window to it.
  await page.keyboard.press('Shift+n')
  await expect(cardNamed(page, 'Stopwatch')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('t')
  await expect(compact.getByRole('heading', { name: 'Stopwatch' })).toBeVisible()
  await expect(digitsOf(compact)).toHaveText('0.00')

  // The palette offers it for the selected card too.
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option', { name: /Open in mini window/ })).toBeVisible()
  await page.keyboard.press('Escape')

  // Its close button closes the window.
  const closed = pip.waitForEvent('close')
  await compact.getByRole('button', { name: 'Close' }).click()
  await closed

  // Its shortcut can be rebound like the others.
  const settings = await openSettings(page, 'Keyboard')
  await expect(settings.getByText('Mini window', { exact: true })).toBeVisible()
  await closeSettings(page)
})

test('without Document Picture-in-Picture the mini window is hidden everywhere', async ({
  page,
}) => {
  await pictureInPicture(page, 'absent')
  await openApp(page)
  const card = selectedCard(page)
  await expect(card.getByRole('button', { name: 'Mini window', includeHidden: true })).toHaveCount(
    0,
  )

  let popups = 0
  page.on('popup', () => {
    popups++
  })
  await page.keyboard.press('t')

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await expect(palette.getByRole('option', { name: /Fullscreen/ })).toBeVisible()
  await expect(palette.getByRole('option', { name: /mini window/i })).toHaveCount(0)
  await page.keyboard.press('Escape')

  await page.keyboard.press('?')
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(help).toBeVisible()
  await expect(help.getByText('Fullscreen', { exact: true })).toBeVisible()
  await expect(help.getByText('Open the mini window')).toHaveCount(0)
  await page.keyboard.press('Escape')

  const settings = await openSettings(page, 'Keyboard')
  await expect(settings.getByText('Fullscreen', { exact: true })).toBeVisible()
  await expect(settings.getByText('Mini window', { exact: true })).toHaveCount(0)
  expect(popups).toBe(0)
})
