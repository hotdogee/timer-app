/**
 * Shared pieces of the end-to-end suite: a `test` that fails on page errors, locators for the
 * app's DOM contract, a paused page clock for tests that depend on time, and helpers for the
 * settings dialog and for saved data.
 *
 * The DOM contract (from the card, grid and palette components): the grid is `[role=grid]`
 * "Cards"; each card is a `[role=gridcell]` named after the card, with `aria-selected`,
 * `data-kind` and `data-phase`; its digits are `[role=timer]`; controls are buttons named by
 * their action (Start, Pause, Lap, …). The settings dialog is the dialog "Settings", with a tab
 * per section; its controls are named by their row labels.
 *
 * Every test starts in a fresh browser context, so its storage is empty: the app opens on its
 * first run (one 5:00 timer and the built-in presets). Pages of one context share their storage
 * and stay in step like tabs. `openDevice` opens another context: another device, with storage
 * of its own.
 *
 * The sync server (`wrangler dev`, see playwright.config.ts) is shared by every test. Each browser
 * context sends a client IP of its own (`CF-Connecting-IP`), so the server's per-IP rate limits
 * (three code emails a minute, for one) apply to each test separately, as to separate people.
 */
import {
  expect,
  test as base,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test'

/** Contexts opened by this worker process so far, for {@link clientIp}. */
let contextsOpened = 0

/**
 * A client IP address no other context of the run uses: `10.<worker>.<n>.<n>`. Worker indexes
 * are unique within a run, and so is the count within a worker.
 */
function clientIp(workerIndex: number): string {
  const n = contextsOpened++
  return `10.${String(workerIndex % 256)}.${String(Math.floor(n / 256) % 256)}.${String(n % 256)}`
}

interface Fixtures {
  /**
   * Console errors the test expects, such as the browser's "Failed to load resource" for a
   * request the test makes fail on purpose (a wrong code, going offline). Push patterns to it.
   */
  allowedErrors: RegExp[]
  /** Console errors and uncaught exceptions of every page of the test (see `test`). */
  pageErrors: string[]
  /**
   * Opens a page in a new browser context: another device, with its own storage, cookies and
   * client IP, and the project's options (base URL, locale). Its pages are watched for errors
   * like the test's own, and it closes when the test ends.
   */
  openDevice: () => Promise<Page>
}

/**
 * Playwright's `test`, failing any test whose pages log a console error or throw an uncaught
 * exception: those are bugs even when the flow under test still works. It watches every page of
 * the test's contexts, including ones the test opens itself. Errors the test expects are listed
 * in `allowedErrors`.
 */
export const test = base.extend<Fixtures & { watchContext: (context: BrowserContext) => void }>({
  extraHTTPHeaders: async ({ extraHTTPHeaders }, use, testInfo) => {
    await use({ ...extraHTTPHeaders, 'CF-Connecting-IP': clientIp(testInfo.workerIndex) })
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's needs from this pattern
  allowedErrors: async ({}, use) => {
    await use([])
  },
  watchContext: async ({ allowedErrors }, use) => {
    const errors: string[] = []
    const record = (error: string): void => {
      if (!allowedErrors.some((pattern) => pattern.test(error))) errors.push(error)
    }
    const watchPage = (watched: Page): void => {
      watched.on('console', (message) => {
        if (message.type() === 'error') record(`console.error: ${message.text()}`)
      })
      watched.on('pageerror', (error) => {
        record(`uncaught: ${error.message}`)
      })
    }
    await use((context) => {
      for (const page of context.pages()) watchPage(page)
      context.on('page', watchPage)
    })
    expect(errors, 'errors in the page').toEqual([])
  },
  pageErrors: [
    async ({ context, watchContext }, use) => {
      watchContext(context)
      await use([])
    },
    { auto: true },
  ],
  openDevice: async ({ browser, watchContext }, use, testInfo) => {
    const contexts: BrowserContext[] = []
    await use(async () => {
      const context = await browser.newContext({
        extraHTTPHeaders: { 'CF-Connecting-IP': clientIp(testInfo.workerIndex) },
      })
      contexts.push(context)
      watchContext(context)
      return context.newPage()
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})

export { expect }

/**
 * Every card in grid order. A card fading out after a delete is still in the DOM for a moment;
 * Svelte makes it inert, so it is skipped.
 */
export function cardCells(page: Page): Locator {
  return page.locator('[role="gridcell"]:not([inert] *)')
}

/** The card named `name`. */
export function cardNamed(page: Page, name: string): Locator {
  return cardCells(page).and(page.getByRole('gridcell', { name, exact: true }))
}

/** The selected card. */
export function selectedCard(page: Page): Locator {
  return cardCells(page).and(page.locator('[aria-selected="true"]'))
}

/** A card's big time readout. */
export function digitsOf(card: Locator): Locator {
  return card.getByRole('timer')
}

/** The card names in grid order, for `expect.poll`. */
export function cardNames(page: Page): Promise<(string | null)[]> {
  return cardCells(page).evaluateAll((cells) =>
    cells.map((cell) => cell.getAttribute('aria-label')),
  )
}

/**
 * The app's polite live region. Dialogs and a natively fullscreen card carry copies of it, for
 * while the page around them is inert; this is the one in the page itself.
 */
export function announcer(page: Page): Locator {
  return page.locator('[role="status"][aria-live="polite"]:not(dialog *):not([data-card-id] *)')
}

/**
 * The snackbar on screen (its message and action), such as the undo one. Only one shows at a
 * time; one sliding out is inert and skipped. (The production build also shows "Ready to work
 * offline" once the service worker has cached the app.)
 */
export function snackbar(page: Page): Locator {
  return page.locator('.snackbar:not([inert])')
}

/**
 * The live region copy inside the open dialog, the one exposed while the dialog is modal (not the
 * copy in a closed dialog nested in it, such as Settings › Data's import question).
 */
export function dialogAnnouncer(page: Page): Locator {
  return page.locator('dialog[open] [role="status"][aria-live="polite"]:not(dialog:not([open]) *)')
}

/** Opens the app and waits for the first-run card. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(cardCells(page)).toHaveCount(1)
}

/**
 * Waits until the app has mounted: its main landmark exists only once the saved data is loaded,
 * whether it shows cards or the empty state.
 */
export async function appMounted(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeAttached()
}

/** Reloads the page and waits for the app to mount again. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload()
  await appMounted(page)
}

/** The settings dialog. */
export function settingsDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Settings' })
}

/** Opens the settings dialog with its shortcut (Mod+,), on `section` when given (its tab name). */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  const dialog = settingsDialog(page)
  await page.keyboard.press('ControlOrMeta+,')
  await expect(dialog).toBeVisible()
  if (section !== undefined) {
    const tab = dialog.getByRole('tab', { name: section, exact: true })
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true')
  }
  return dialog
}

/** Closes the settings dialog with its close button. */
export async function closeSettings(page: Page): Promise<void> {
  const dialog = settingsDialog(page)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
}

/** The IndexedDB database of the synced store (cards, presets, behavior settings). */
const SYNCED_DB_NAME = 'timer-app'

/**
 * Everything the synced store has saved in IndexedDB, as JSON text ('' while nothing is saved).
 * Tests compare snapshots of it to know that a change reached the disk; they do not parse it, so
 * they do not depend on TinyBase's storage format. Call it once the app has mounted.
 */
export function savedData(page: Page): Promise<string> {
  return page.evaluate(async (dbName) => {
    const known = await indexedDB.databases()
    if (!known.some((db) => db.name === dbName)) return ''
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName)
      request.onsuccess = () => {
        // Never hold up the app's own upgrade of the database (its first save).
        request.result.onversionchange = () => {
          request.result.close()
        }
        resolve(request.result)
      }
      request.onerror = () => {
        reject(new Error(`could not open ${dbName}`))
      }
    })
    try {
      const names = [...db.objectStoreNames].sort()
      if (names.length === 0) return ''
      const transaction = db.transaction(names, 'readonly')
      const contents = await Promise.all(
        names.map(
          (name) =>
            new Promise<unknown>((resolve, reject) => {
              const request = transaction.objectStore(name).getAll()
              request.onsuccess = () => {
                resolve(request.result)
              }
              request.onerror = () => {
                reject(new Error(`could not read ${name}`))
              }
            }),
        ),
      )
      return JSON.stringify(contents)
    } finally {
      db.close()
    }
  }, SYNCED_DB_NAME)
}

/**
 * Runs `change`, then waits until the synced store has saved since and is done saving (nothing
 * new for a moment): a reload, or closing the page, that follows then finds the change on disk.
 * The app saves a few milliseconds after every change; leaving the page at once could cut that
 * write short.
 */
export async function savedAfter(page: Page, change: () => Promise<unknown>): Promise<void> {
  const before = await savedData(page)
  await change()
  await expect
    .poll(
      async () => {
        const saved = await savedData(page)
        if (saved === before) return false
        await page.waitForTimeout(100)
        return (await savedData(page)) === saved
      },
      { message: 'the change is saved to IndexedDB' },
    )
    .toBe(true)
}

/**
 * Opens the app with the page clock installed, lets it load in running time, then stops the clock
 * and returns the paused time. From then on time moves only through `page.clock.runFor`, so
 * displays are exact. The clock starts an hour ahead of real time (on a whole hour, UTC): the wake
 * worker, which keeps real time, then never fires during a test.
 */
export async function openWithPausedClock(page: Page): Promise<number> {
  const hour = 3_600_000
  const start = Math.ceil(Date.now() / hour) * hour + hour
  await page.clock.install({ time: start })
  await openApp(page)
  const pausedAt = start + 60_000
  await page.clock.pauseAt(pausedAt)
  return pausedAt
}
