/**
 * Time's up in the browser: one looping alarm sound however many cards ring, muting, system
 * notifications (and their clicks), the background wake-up in a hidden tab, typing on a paused or
 * ringing timer, and the fullscreen overlay where the Fullscreen API is missing. Browser APIs the
 * test cannot observe directly are wrapped before the app loads (`page.addInitScript`).
 */
import type { Page } from '@playwright/test'

import {
  cardNamed,
  digitsOf,
  expect,
  openApp,
  openWithPausedClock,
  selectedCard,
  test,
} from './support'

/**
 * Records alarm playback and notifications. Each looping source started adds one to
 * `window.__alarm.looping` and each one stopped takes one away, so it reads how many alarm sounds
 * play. Notifications are a fake `Notification` class (permission granted) that records every
 * notification shown, and `window.focus` counts its calls.
 */
const INSTRUMENT = `
(() => {
  const log = { looping: 0, notifications: [], focus: 0 };
  window.__alarm = log;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    if (this.loop) { log.looping++; this.__counted = true; }
    return start.apply(this, args);
  };
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.stop = function (...args) {
    if (this.__counted) { log.looping--; this.__counted = false; }
    return stop.apply(this, args);
  };
  class FakeNotification {
    static permission = 'granted';
    static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, options) {
      this.title = title;
      this.body = options?.body;
      this.closed = false;
      this.onclick = null;
      log.notifications.push(this);
    }
    close() { this.closed = true; }
  }
  window.Notification = FakeNotification;
  const focus = window.focus;
  window.focus = function () { log.focus++; return focus.call(window); };
})();
`

interface AlarmLog {
  looping: number
  notifications: { title: string; body: string | undefined; closed: boolean }[]
  focus: number
}

function alarmLog(page: Page): Promise<AlarmLog> {
  return page.evaluate(() => {
    const log = (window as unknown as { __alarm: AlarmLog }).__alarm
    return {
      looping: log.looping,
      notifications: log.notifications.map(({ title, body, closed }) => ({ title, body, closed })),
      focus: log.focus,
    }
  })
}

/** How many alarm sounds play now. Rendering the sound takes a moment, so poll it. */
function looping(page: Page): Promise<number> {
  return alarmLog(page).then((log) => log.looping)
}

test.describe('the alarm', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(INSTRUMENT)
  })

  test('plays one looping sound while any unmuted card rings; muting silences it', async ({
    page,
  }) => {
    await openWithPausedClock(page)
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('n')
    await page.keyboard.type('2')
    await page.keyboard.press('Enter')

    await page.clock.runFor(1100)
    await expect(cardNamed(page, 'Timer')).toHaveAttribute('data-phase', 'ringing')
    await expect.poll(() => looping(page)).toBe(1)

    // A second card ringing does not start a second sound.
    await page.clock.runFor(1000)
    await expect(cardNamed(page, 'Timer 2')).toHaveAttribute('data-phase', 'ringing')
    await expect.poll(() => looping(page)).toBe(1)

    // Muting one ringing card keeps the sound for the other; muting both silences it.
    await page.keyboard.press('m')
    await expect.poll(() => looping(page)).toBe(1)
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('m')
    await expect.poll(() => looping(page)).toBe(0)
    await page.keyboard.press('m')
    await expect.poll(() => looping(page)).toBe(1)

    // Dismissing both ends it.
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-phase="ringing"]')).toHaveCount(0)
    await expect.poll(() => looping(page)).toBe(0)
  })

  test('shows a notification per card; clicking it focuses the app and dismisses that card', async ({
    page,
  }) => {
    await openWithPausedClock(page)
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await page.keyboard.press('n')
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await page.clock.runFor(1100)

    await expect
      .poll(async () => (await alarmLog(page)).notifications)
      .toEqual([
        { title: 'Timer', body: "Time's up", closed: false },
        { title: 'Timer 2', body: "Time's up", closed: false },
      ])

    await page.evaluate(() => {
      const log = (window as unknown as { __alarm: { notifications: { onclick: () => void }[] } })
        .__alarm
      log.notifications[1]?.onclick()
    })
    await expect(cardNamed(page, 'Timer 2')).toHaveAttribute('data-phase', 'idle')
    await expect(cardNamed(page, 'Timer')).toHaveAttribute('data-phase', 'ringing')
    const log = await alarmLog(page)
    expect(log.focus).toBeGreaterThanOrEqual(1)
    expect(log.notifications.map((n) => n.closed)).toEqual([false, true])

    // Dismissing on the card closes its notification too.
    await cardNamed(page, 'Timer').getByRole('button', { name: 'Dismiss' }).click()
    await expect
      .poll(async () => (await alarmLog(page)).notifications.map((n) => n.closed))
      .toEqual([true, true])
  })
})

test('a hidden tab rings on time without animation frames (the wake worker)', async ({ page }) => {
  // The tab reports itself hidden and never runs animation frames, as a background tab.
  await page.addInitScript(`
    Object.defineProperty(Document.prototype, 'visibilityState', { get: () => 'hidden', configurable: true });
    Object.defineProperty(Document.prototype, 'hidden', { get: () => true, configurable: true });
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
  `)
  await openApp(page)
  const card = selectedCard(page)
  await page.keyboard.type('2')
  const started = Date.now()
  await page.keyboard.press('Enter')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await expect(card).toHaveAttribute('data-phase', 'ringing', { timeout: 5000 })
  expect(Date.now() - started).toBeGreaterThanOrEqual(1900)
})

test.describe('digits on a timer that is not running', () => {
  test('replace a paused timer’s duration; Esc keeps the paused time', async ({ page }) => {
    await openWithPausedClock(page)
    const card = selectedCard(page)
    await page.keyboard.type('11500')
    await page.keyboard.press('Enter')
    await page.clock.runFor(5000)
    await page.keyboard.press('Space')
    await expect(card).toHaveAttribute('data-phase', 'paused')
    await expect(digitsOf(card)).toHaveText('1:14:55')

    await page.keyboard.type('2')
    await expect(digitsOf(card)).toHaveText('00:00:02')
    await page.keyboard.press('Escape')
    await expect(digitsOf(card)).toHaveText('1:14:55')
    await expect(card).toHaveAttribute('data-phase', 'paused')

    // Applied, they reset the timer to the new duration and start it.
    await page.keyboard.type('2')
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('data-phase', 'running')
    await expect(digitsOf(card)).toHaveText('0:02')
  })

  test('dismiss a ringing timer and set the new duration', async ({ page }) => {
    await openWithPausedClock(page)
    const card = selectedCard(page)
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
    await page.clock.runFor(1100)
    await expect(card).toHaveAttribute('data-phase', 'ringing')

    await page.keyboard.type('4')
    await expect(card).toHaveAttribute('data-phase', 'idle')
    await expect(digitsOf(card)).toHaveText('00:00:04')
    await page.keyboard.press('Enter')
    await expect(digitsOf(card)).toHaveText('0:04')
  })
})

test.describe('fullscreen without the Fullscreen API (the overlay)', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(`
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false, configurable: true });
      Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false, configurable: true });
    `)
  })

  test('F shows the card as an overlay that keeps Tab inside it; Esc closes it', async ({
    page,
  }) => {
    await openApp(page)
    await page.keyboard.press('n')
    const card = selectedCard(page)
    await expect(card).toHaveAccessibleName('Timer 2')

    await page.keyboard.press('f')
    await expect(card).toHaveAttribute('data-fullscreen-fallback', '')
    await expect(card.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
    // Everything else is out of reach, as native fullscreen makes it.
    await expect(cardNamed(page, 'Timer')).toHaveAttribute('inert', '')
    const editButton = page.getByRole('button', { name: 'Edit cards', includeHidden: true })
    expect(await editButton.evaluate((el) => el.closest('[inert]') !== null)).toBe(true)
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab')
      const inside = await card.evaluate((el) => el.contains(document.activeElement))
      const onBody = await page.evaluate(() => document.activeElement === document.body)
      expect(inside || onBody, `Tab ${String(i + 1)} stays in the overlay`).toBe(true)
    }
    await expect(card).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('Escape')
    await expect(card).not.toHaveAttribute('data-fullscreen-fallback')
    await expect(cardNamed(page, 'Timer')).not.toHaveAttribute('inert')
    expect(await editButton.evaluate((el) => el.closest('[inert]') !== null)).toBe(false)
  })

  test('the overlay follows the selection, so keys act on the card in view', async ({ page }) => {
    await openApp(page)
    await page.keyboard.press('n')
    await page.keyboard.press('f')
    await expect(cardNamed(page, 'Timer 2')).toHaveAttribute('data-fullscreen-fallback', '')
    await page.keyboard.press('ArrowLeft')
    await expect(cardNamed(page, 'Timer')).toHaveAttribute('data-fullscreen-fallback', '')
    await expect(cardNamed(page, 'Timer 2')).not.toHaveAttribute('data-fullscreen-fallback')
    await page.keyboard.press('Space')
    await expect(cardNamed(page, 'Timer')).toHaveAttribute('data-phase', 'running')
    await expect(cardNamed(page, 'Timer 2')).toHaveAttribute('data-phase', 'idle')
  })
})
