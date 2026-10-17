import type { Page } from '@playwright/test'

import { cardCells, expect, openApp, selectedCard, test } from './support'

/** What the page's requestAnimationFrame wrapper records. */
interface RafProbe {
  /** Calls to requestAnimationFrame. */
  requests: number
  /** Callbacks run, by frame timestamp. */
  perFrame: Map<number, number>
}

declare global {
  interface Window {
    __rafProbe?: RafProbe
  }
}

/** Counts the page's animation frame requests and callbacks while `ms` passes. */
async function measureFrames(
  page: Page,
  ms: number,
): Promise<{ requests: number; frames: number; maxCallbacksPerFrame: number }> {
  return page.evaluate(async (duration) => {
    const probe = window.__rafProbe
    if (!probe) throw new Error('requestAnimationFrame probe missing')
    probe.requests = 0
    probe.perFrame.clear()
    await new Promise((resolve) => setTimeout(resolve, duration))
    const counts = [...probe.perFrame.values()]
    return {
      requests: probe.requests,
      frames: counts.length,
      maxCallbacksPerFrame: Math.max(0, ...counts),
    }
  }, ms)
}

test.beforeEach(async ({ page }) => {
  // Wrap requestAnimationFrame before any app code runs.
  await page.addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window)
    const probe: RafProbe = { requests: 0, perFrame: new Map() }
    window.__rafProbe = probe
    window.requestAnimationFrame = (callback) => {
      probe.requests++
      return native((time) => {
        probe.perFrame.set(time, (probe.perFrame.get(time) ?? 0) + 1)
        callback(time)
      })
    }
  })
})

test('requests no animation frames while nothing runs', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('Shift+N')
  await expect(cardCells(page)).toHaveCount(2)
  const idle = await measureFrames(page, 500)
  expect(idle.requests).toBe(0)
  expect(idle.frames).toBe(0)
})

test('runs one animation frame callback per frame for three running cards', async ({ page }) => {
  await openApp(page)
  // Start the first timer, then add and start two more (a timer and a stopwatch).
  await page.keyboard.press('Enter')
  await page.keyboard.press('n')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Shift+N')
  await page.keyboard.press('Space')
  await expect(cardCells(page)).toHaveCount(3)
  await expect(selectedCard(page)).toHaveAttribute('data-phase', 'running')
  await expect(page.locator('[role="gridcell"][data-phase="running"]')).toHaveCount(3)

  const running = await measureFrames(page, 1000)
  expect(running.frames).toBeGreaterThan(10)
  expect(running.maxCallbacksPerFrame).toBe(1)
  // Each frame asks for the next one: one request per frame, give or take the one in flight.
  expect(Math.abs(running.requests - running.frames)).toBeLessThanOrEqual(1)

  // Pausing everything stops the loop again.
  for (const card of await cardCells(page).all()) {
    await card.getByRole('button', { name: 'Pause' }).click()
  }
  await expect(page.locator('[role="gridcell"][data-phase="paused"]')).toHaveCount(3)
  const paused = await measureFrames(page, 500)
  expect(paused.requests).toBe(0)
})
