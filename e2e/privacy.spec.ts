/**
 * The privacy policy's public page, `/privacy` (spec › Sync › Obligations): `docs/privacy.md`
 * rendered by the build (vite.config.ts › privacyPage, scripts/privacy-page.mjs). Production
 * serves it as `dist/privacy.html` from Workers static assets, and the Google sign-in consent
 * screen and the store listings link it, so it must be the policy and never the app's shell (the
 * single-page-application fallback, or the service worker's navigation fallback). These run on
 * both paths: the dev server renders the page itself, and wrangler serves the build's file.
 */
import { cardCells, expect, openApp, openSettings, selectedCard, test } from './support'

/** The same choice as playwright.config.ts: preview in CI, dev locally, unless E2E_SERVER says. */
const server = process.env.E2E_SERVER ?? (process.env.CI ? 'preview' : 'dev')

const TITLE = 'Privacy policy – Timer App'

test('serves the privacy policy at /privacy as a page of its own, not the app', async ({
  page,
}) => {
  const response = await page.goto('/privacy')
  expect(response?.status()).toBe(200)
  expect(response?.headers()['content-type']).toMatch(/^text\/html/)
  // The policy, standalone: no app root and no scripts, so not the app shell.
  const body = (await response?.text()) ?? ''
  expect(body).toContain('<html lang="en">')
  expect(body).not.toContain('id="app"')
  expect(body).not.toContain('<script')
  await expect(page.locator('script')).toHaveCount(0)

  await expect(page).toHaveTitle(TITLE)
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible()
  await expect(page.getByText(/^Last updated \d{4}-\d{2}-\d{2}\./)).toBeVisible()
  // The operator and the contact address.
  await expect(page.getByText('Han Lin, hotdogee@gmail.com')).toBeVisible()
  await expect(page.getByRole('link', { name: 'hotdogee@gmail.com' })).toHaveAttribute(
    'href',
    'mailto:hotdogee@gmail.com',
  )
  await expect(page.getByText(/Draft|\[Operator name\]/)).toHaveCount(0)

  // A link to a section of the page goes to its heading.
  await page.getByRole('link', { name: 'Logs', exact: true }).click()
  await expect(page).toHaveURL(/\/privacy#logs$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Logs' })).toBeInViewport()

  // The link back opens the app.
  const back = page.getByRole('link', { name: 'Back to Timer App' })
  await expect(back).toHaveAttribute('href', '/')
  await back.click()
  await expect(page).toHaveURL(/\/$/)
  await expect(cardCells(page)).toHaveCount(1)
})

test('the home page says what the app is and links the policy', async ({ page, context }) => {
  // Google's brand verification (the sign-in consent screen) looks for both on the home page.
  await openApp(page)
  const footer = page.locator('footer.about')
  await expect(footer).toContainText('Timer App is a keyboard-first timer and stopwatch.')
  const link = footer.getByRole('link', { name: 'Privacy policy' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', '/privacy')
  const [policy] = await Promise.all([context.waitForEvent('page'), link.click()])
  await expect(policy).toHaveTitle(TITLE)
  await expect(policy.getByText('Han Lin, hotdogee@gmail.com')).toBeVisible()
  // With no cards it is still there, under the empty state.
  await selectedCard(page).focus()
  await page.keyboard.press('Delete')
  await expect(page.getByRole('heading', { name: 'No timers yet' })).toBeVisible()
  await expect(link).toBeVisible()
})

test('Settings › About links the policy, which opens in a new tab', async ({ page, context }) => {
  await openApp(page)
  const dialog = await openSettings(page, 'About')
  const link = dialog.getByRole('link', { name: 'Privacy policy' })
  await expect(link).toHaveAttribute('href', '/privacy')
  const [policy] = await Promise.all([context.waitForEvent('page'), link.click()])
  await expect(policy).toHaveTitle(TITLE)
  await expect(policy.getByText('Han Lin, hotdogee@gmail.com')).toBeVisible()
})

test('the service worker answers /privacy with the policy, offline too', async ({
  page,
  context,
  allowedErrors,
}) => {
  test.skip(
    server !== 'preview',
    'needs the production build (pnpm build, then E2E_SERVER=preview)',
  )
  // Offline, the app's session check and its server settings request fail, and the browser logs
  // both (as in pwa.spec.ts).
  allowedErrors.push(/Failed to load resource: net::ERR_INTERNET_DISCONNECTED/)
  await openApp(page)
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? 'none'),
      { message: 'the service worker activates (main.ts calls registerPwa())', timeout: 20_000 },
    )
    .toBe('activated')

  // The worker's navigation fallback (the app shell) must not answer: its precache does.
  await context.setOffline(true)
  await page.goto('/privacy')
  await expect(page).toHaveTitle(TITLE)
  await expect(page.getByText('Han Lin, hotdogee@gmail.com')).toBeVisible()
  await expect(page.locator('#app')).toHaveCount(0)
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')
})
