/**
 * The installable, offline web app (spec › Persistence and instances): the manifest and icons, the
 * service worker, and a reload with the network off. Only the production build has a manifest and
 * a worker, so these run against `pnpm preview` (`E2E_SERVER=preview`, the CI default; run
 * `pnpm build` first) and are skipped against the dev server.
 */
import { cardCells, expect, test } from './support'

/** The same choice as playwright.config.ts: preview in CI, dev locally, unless E2E_SERVER says. */
const server = process.env.E2E_SERVER ?? (process.env.CI ? 'preview' : 'dev')

test.skip(server !== 'preview', 'needs the production build (pnpm build, then E2E_SERVER=preview)')

interface ManifestIcon {
  src: string
  sizes: string
  type?: string
  purpose?: string
}

interface Manifest {
  name: string
  short_name: string
  start_url: string
  display: string
  icons: ManifestIcon[]
}

test('links a manifest with the app name and icons, and every icon loads', async ({ page }) => {
  await page.goto('/')
  const href = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(href).toBeTruthy()
  const manifestUrl = new URL(href ?? '', page.url())
  const response = await page.request.get(manifestUrl.href)
  expect(response.ok()).toBe(true)
  const manifest = (await response.json()) as Manifest
  expect(manifest).toMatchObject({
    name: 'Timer App',
    short_name: 'Timer',
    start_url: '/',
    display: 'standalone',
  })
  const icons = manifest.icons.map(({ sizes, purpose }) => `${sizes} ${purpose ?? 'any'}`)
  expect(icons).toEqual(expect.arrayContaining(['192x192 any', '512x512 any', '512x512 maskable']))

  // The manifest's icons and the page's own icon links all resolve to images.
  const iconUrls = manifest.icons.map(({ src }) => new URL(src, manifestUrl).href)
  const links = page.locator('link[rel="icon"], link[rel="apple-touch-icon"]')
  await expect(links).toHaveCount(3)
  for (const link of await links.all()) {
    iconUrls.push(new URL((await link.getAttribute('href')) ?? '', page.url()).href)
  }
  for (const url of iconUrls) {
    const icon = await page.request.get(url)
    expect(icon.ok(), url).toBe(true)
    expect(icon.headers()['content-type'], url).toMatch(/^image\//)
  }
})

test('activates the service worker and reloads with the network off', async ({ page, context }) => {
  await page.goto('/')
  await expect(cardCells(page).first()).toBeVisible()
  // The worker installs (precaching the whole app) before it activates.
  await expect
    .poll(
      () =>
        page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state ?? 'none'),
      { message: 'the service worker activates (main.ts calls registerPwa())' },
    )
    .toBe('activated')

  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('grid', { name: 'Cards' })).toBeVisible()
  await expect(cardCells(page).first()).toBeVisible()
  // The page came from the worker, not the network.
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')
  // The page is offline, yet the app font loaded: it came from the precache too.
  expect(await page.evaluate(() => navigator.onLine)).toBe(false)
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.fonts].some(
          (face) => face.family.includes('Roboto Flex') && face.status === 'loaded',
        ),
      ),
    )
    .toBe(true)
})
