/**
 * Settings › Data (spec › Settings): Export saves cards, presets and settings as JSON; Import
 * replaces them with a file's after asking, and explains why a file it cannot use was refused.
 */
import { readFile } from 'node:fs/promises'

import type { Page } from '@playwright/test'

import {
  cardCells,
  cardNamed,
  cardNames,
  closeSettings,
  dialogAnnouncer,
  digitsOf,
  expect,
  openApp,
  openSettings,
  reloadApp,
  savedAfter,
  selectedCard,
  test,
} from './support'

test.use({ viewport: { width: 1280, height: 800 } })

/** The parts of an export file these tests read. */
interface ExportFile {
  app: string
  format: number
  exportedAt: number
  cards: { id: string; kind: string; name: string; muted: boolean; timer?: { phase: string } }[]
  presets: { id: string; name: string; duration: number }[]
  settings: {
    synced: { timeStyle: string; confirmDelete: boolean }
    device: { themeMode: string }
  }
}

/** Picks `contents` as the import file, as the hidden file input of Settings › Data. */
async function pickImportFile(page: Page, name: string, contents: string): Promise<void> {
  await page
    .getByRole('dialog', { name: 'Settings' })
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(contents) })
}

test('Export downloads a JSON file that matches the cards, presets and settings', async ({
  page,
}) => {
  await openApp(page)
  await page.keyboard.press('Shift+N')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Enter')
  await expect(cardNamed(page, 'Timer')).toHaveAttribute('data-phase', 'running')

  const dialog = await openSettings(page, 'Appearance')
  await dialog
    .getByRole('radiogroup', { name: 'Theme' })
    .getByRole('radio', { name: 'Dark' })
    .check()
  await dialog.getByRole('tab', { name: 'Behavior' }).click()
  await dialog
    .getByRole('radiogroup', { name: 'Time format' })
    .getByRole('radio', { name: 'Fixed' })
    .check()
  await dialog.getByRole('tab', { name: 'Data' }).click()
  const before = Date.now()
  const download = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Export' }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^timer-app-\d{4}-\d{2}-\d{2}\.json$/)

  const data = JSON.parse(await readFile(await file.path(), 'utf8')) as ExportFile
  expect(data).toMatchObject({ app: 'timer-app', format: 1 })
  expect(data.exportedAt).toBeGreaterThanOrEqual(before)
  expect(data.cards.map(({ name, kind }) => ({ name, kind }))).toEqual([
    { name: 'Timer', kind: 'timer' },
    { name: 'Stopwatch', kind: 'stopwatch' },
  ])
  expect(data.cards[0]?.timer?.phase).toBe('running')
  expect(data.presets.map(({ name, duration }) => ({ name, duration }))).toEqual([
    { name: 'Tea', duration: 180_000 },
    { name: 'Pomodoro', duration: 1_500_000 },
    { name: 'Break', duration: 300_000 },
    { name: 'Eggs', duration: 420_000 },
  ])
  expect(data.settings.synced).toMatchObject({ timeStyle: 'fixed', confirmDelete: false })
  expect(data.settings.device).toMatchObject({ themeMode: 'dark' })
})

test('Import replaces cards, presets and settings after asking', async ({ page }) => {
  await openApp(page)
  const crafted = {
    app: 'timer-app',
    format: 1,
    exportedAt: Date.UTC(2026, 9, 18),
    cards: [
      {
        id: 'imported-tea',
        kind: 'timer',
        name: 'Green tea',
        createdAt: 1,
        muted: true,
        timer: { phase: 'idle', duration: 120_000 },
      },
      {
        id: 'imported-run',
        kind: 'stopwatch',
        name: 'Run',
        createdAt: 2,
        muted: false,
        stopwatch: { phase: 'paused', accumulated: 65_430, laps: [30_000] },
      },
    ],
    presets: [{ id: 'soup', name: 'Soup', duration: 600_000 }],
    // Settings are read field by field; missing ones take their defaults.
    settings: { synced: { timeStyle: 'fixed' }, device: { density: 'compact' } },
  }
  const text = JSON.stringify(crafted)

  const dialog = await openSettings(page, 'Data')
  // The app's confirm dialog, as for a delete.
  const question = page.getByRole('alertdialog', { name: 'Import this file?' })

  // Cancel leaves everything as it was.
  await pickImportFile(page, 'backup.json', text)
  await expect(question).toBeVisible()
  await expect(question).toContainText(
    'Replace your 1 card and 4 presets with 2 cards and 1 preset from this file?',
  )
  await question.getByRole('button', { name: 'Cancel' }).click()
  await expect(question).toBeHidden()
  await expect(dialog).toBeVisible()
  await expect.poll(() => cardNames(page)).toEqual(['Timer'])

  await pickImportFile(page, 'backup.json', text)
  await expect(question).toBeVisible()
  await savedAfter(page, async () => {
    await question.getByRole('button', { name: 'Replace' }).click()
    await expect(question).toBeHidden()
    await expect.poll(() => cardNames(page)).toEqual(['Green tea', 'Run'])
  })
  await expect(dialog.getByText('Imported 2 cards and 1 preset')).toBeVisible()
  // That is the announcement: the cards are not announced one by one as well.
  await expect(dialogAnnouncer(page)).not.toContainText('Green tea')
  await closeSettings(page)

  const assertImported = async (): Promise<void> => {
    await expect.poll(() => cardNames(page)).toEqual(['Green tea', 'Run'])
    const tea = cardNamed(page, 'Green tea')
    await expect(digitsOf(tea)).toHaveText('00:02:00')
    await expect(tea.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true')
    const run = cardNamed(page, 'Run')
    await expect(run).toHaveAttribute('data-phase', 'paused')
    await expect(digitsOf(run)).toHaveText('00:01:05.43')
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact')
    await page.keyboard.press('p')
    const menu = page.getByRole('menu', { name: 'New timer' })
    await expect(menu.getByRole('menuitem')).toHaveText([/Timer\s*00:05:00/, /Soup\s*00:10:00/])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  }
  await assertImported()
  await reloadApp(page)
  await assertImported()
})

test('an invalid file is refused with the reason, and nothing changes', async ({ page }) => {
  await openApp(page)
  const dialog = await openSettings(page, 'Data')
  const alert = dialog.getByRole('alert')

  await pickImportFile(page, 'notes.json', 'these are not the cards you are looking for')
  await expect(alert).toContainText("Can't import this file")
  await expect(alert).toContainText("The file isn't valid JSON.")

  await pickImportFile(page, 'other.json', JSON.stringify({ app: 'another-app', items: [] }))
  await expect(alert).toContainText("The file isn't a Timer App export.")

  await pickImportFile(
    page,
    'future.json',
    JSON.stringify({ app: 'timer-app', format: 99, cards: [], presets: [], settings: {} }),
  )
  await expect(alert).toContainText('The file is from a newer version of Timer App.')

  await expect(page.getByRole('alertdialog', { name: 'Import this file?' })).toHaveCount(0)
  await closeSettings(page)
  await expect(cardCells(page)).toHaveCount(1)
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
})
