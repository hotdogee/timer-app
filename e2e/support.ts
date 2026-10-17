/**
 * Shared pieces of the end-to-end suite: a `test` that fails on page errors, locators for the
 * app's DOM contract, and a paused page clock for tests that depend on time.
 *
 * The DOM contract (from the card, grid and palette components): the grid is `[role=grid]`
 * "Cards"; each card is a `[role=gridcell]` named after the card, with `aria-selected`,
 * `data-kind` and `data-phase`; its digits are `[role=timer]`; controls are buttons named by
 * their action (Start, Pause, Lap, …).
 */
import { expect, test as base, type Locator, type Page } from '@playwright/test'

/**
 * Playwright's `test`, failing any test whose page logs a console error or throws an uncaught
 * exception: those are bugs even when the flow under test still works.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
      })
      page.on('pageerror', (error) => {
        errors.push(`uncaught: ${error.message}`)
      })
      await use(errors)
      expect(errors, 'errors in the page').toEqual([])
    },
    { auto: true },
  ],
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

/** The undo snackbar (its message and Undo button). */
export function snackbar(page: Page): Locator {
  return page.locator('.snackbar')
}

/** The live region copy inside the open dialog, the one exposed while the dialog is modal. */
export function dialogAnnouncer(page: Page): Locator {
  return page.locator('dialog[open] [role="status"][aria-live="polite"]')
}

/** Opens the app and waits for the first-run card. */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(cardCells(page)).toHaveCount(1)
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
