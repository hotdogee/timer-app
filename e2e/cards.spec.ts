import {
  announcer,
  cardCells,
  cardNamed,
  cardNames,
  digitsOf,
  expect,
  openApp,
  openWithPausedClock,
  selectedCard,
  snackbar,
  test,
} from './support'

// Three cards fit in one row at this width, so left and right walk the whole list.
test.use({ viewport: { width: 1280, height: 800 } })

test('N and Shift+N add cards, arrows select, Delete removes with undo, Mod+Z restores', async ({
  page,
}) => {
  await openApp(page)

  await page.keyboard.press('n')
  await expect(cardCells(page)).toHaveCount(2)
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 2')
  await expect(digitsOf(selectedCard(page))).toHaveText('5:00')
  await expect(announcer(page)).toHaveText('Added Timer 2')

  await page.keyboard.press('Shift+N')
  await expect(cardCells(page)).toHaveCount(3)
  await expect(selectedCard(page)).toHaveAccessibleName('Stopwatch')
  await expect(selectedCard(page)).toHaveAttribute('data-kind', 'stopwatch')
  await expect(digitsOf(selectedCard(page))).toHaveText('0.00')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 2', 'Stopwatch'])

  // Exactly one card is selected at a time.
  await page.keyboard.press('ArrowLeft')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 2')
  await page.keyboard.press('ArrowLeft')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
  await page.keyboard.press('ArrowLeft')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
  await page.keyboard.press('ArrowRight')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 2')
  await expect(selectedCard(page)).toHaveCount(1)
  await expect(cardNamed(page, 'Timer')).toHaveAttribute('aria-selected', 'false')

  // Delete: the selection moves to the next card, and the snackbar offers Undo.
  await page.keyboard.press('Delete')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Stopwatch'])
  await expect(selectedCard(page)).toHaveAccessibleName('Stopwatch')
  await expect(snackbar(page)).toContainText('Deleted Timer 2')
  // The app's live region announces the delete once, with the undo shortcut.
  await expect(announcer(page)).toHaveText(/^Deleted Timer 2\. Press (Ctrl\+Z|⌘Z) to undo\.$/)
  const undo = page.getByRole('button', { name: 'Undo' })
  await expect(undo).toBeVisible()

  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 2', 'Stopwatch'])
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 2')
  await expect(undo).toHaveCount(0)
  await expect(announcer(page)).toHaveText('Restored Timer 2')

  // Undo works once: a second Mod+Z changes nothing.
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 2', 'Stopwatch'])
})

test('the snackbar Undo button restores a card deleted from its header in edit mode', async ({
  page,
}) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.getByRole('button', { name: 'Edit cards' }).click()
  await cardNamed(page, 'Timer').getByRole('button', { name: 'Delete Timer', exact: true }).click()
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2'])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 2'])
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
})

test('edit mode: E shows name fields, F2 renames, Ctrl+Arrow moves the card', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('ArrowLeft')
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')

  const nameFields = page.getByRole('textbox', { name: 'Card name' })
  await page.keyboard.press('e')
  await expect(nameFields).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Edit cards' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Move Timer', exact: true })).toBeVisible()

  // F2 focuses the selected card's field with its name selected; typing replaces it.
  await page.keyboard.press('F2')
  const field = selectedCard(page).getByRole('textbox', { name: 'Card name' })
  await expect(field).toBeFocused()
  await page.keyboard.type('Tea')
  // Keys typed into the field stay there: Delete edits text, it does not delete the card.
  await page.keyboard.press('Delete')
  await expect(cardCells(page)).toHaveCount(2)
  await page.keyboard.press('Enter')
  await expect(cardNamed(page, 'Tea')).toBeFocused()
  await expect(cardNamed(page, 'Tea').getByRole('textbox')).toHaveValue('Tea')
  await expect.poll(() => cardNames(page)).toEqual(['Tea', 'Timer 2'])

  // Ctrl+Arrow moves the selected card (in or out of edit mode); the selection stays on it.
  await page.keyboard.press('Control+ArrowRight')
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2', 'Tea'])
  await expect(selectedCard(page)).toHaveAccessibleName('Tea')

  // Esc leaves edit mode; the header shows the new name.
  await page.keyboard.press('Escape')
  await expect(nameFields).toHaveCount(0)
  await expect(cardNamed(page, 'Tea').getByRole('heading', { name: 'Tea' })).toBeVisible()

  await page.keyboard.press('Control+ArrowLeft')
  await expect.poll(() => cardNames(page)).toEqual(['Tea', 'Timer 2'])
})

test('Esc in a rename field reverts the name; F2 works outside edit mode', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('F2')
  const field = page.getByRole('textbox', { name: 'Card name' })
  await expect(field).toBeFocused()
  await page.keyboard.type('Pasta')
  await page.keyboard.press('Escape')
  await expect(field).toHaveCount(0)
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')
  await expect(selectedCard(page)).toBeFocused()
})

test('P opens the + Timer menu, whose presets add named timers', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('p')
  const menu = page.getByRole('menu', { name: 'New timer' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText([
    /Timer\s*5:00/,
    /Tea\s*3:00/,
    /Pomodoro\s*25:00/,
    /Break\s*5:00/,
    /Eggs\s*7:00/,
  ])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()

  // The menu opens above its trigger, clear of it, and stays clear once its animation ends.
  const trigger = page.getByRole('button', { name: 'New timer' })
  const gap = async (): Promise<number> => {
    const [menuBox, triggerBox] = await Promise.all([menu.boundingBox(), trigger.boundingBox()])
    if (!menuBox || !triggerBox) throw new Error('no box')
    return triggerBox.y - (menuBox.y + menuBox.height)
  }
  expect(await gap()).toBeGreaterThanOrEqual(3.5)
  await page.waitForTimeout(400)
  expect(await gap()).toBeGreaterThanOrEqual(3.5)

  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(selectedCard(page)).toHaveAccessibleName('Tea')
  await expect(digitsOf(selectedCard(page))).toHaveText('3:00')
  await expect(selectedCard(page)).toHaveAttribute('data-phase', 'idle')
})

test('clicking a card selects it, and its buttons act on it', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'New stopwatch' }).click()
  await expect(selectedCard(page)).toHaveAccessibleName('Stopwatch')

  const timerCard = cardNamed(page, 'Timer')
  await timerCard.getByRole('timer').click()
  await expect(timerCard).toHaveAttribute('aria-selected', 'true')
  await timerCard.getByRole('button', { name: '+1:00' }).click()
  await expect(digitsOf(timerCard)).toHaveText('6:00')

  // Space on a focused button presses that button only; it does not also toggle the timer.
  await timerCard.getByRole('button', { name: 'Start' }).focus()
  await page.keyboard.press('Space')
  await expect(timerCard).toHaveAttribute('data-phase', 'running')
  await expect(timerCard.getByRole('button', { name: 'Pause' })).toBeVisible()
})

test('F shows the selected card fullscreen and F again leaves; M mutes it', async ({ page }) => {
  await openApp(page)
  const card = selectedCard(page)
  const isFullscreen = (): Promise<boolean> =>
    card.evaluate((element) => document.fullscreenElement === element)

  await page.keyboard.press('f')
  await expect.poll(isFullscreen).toBe(true)
  await expect(card.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible()
  await page.keyboard.press('f')
  await expect.poll(isFullscreen).toBe(false)
  await expect(card.getByRole('button', { name: 'Fullscreen' })).toBeVisible()

  const mute = card.getByRole('button', { name: 'Mute' })
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('m')
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('m')
  await expect(mute).toHaveAttribute('aria-pressed', 'false')
  // The mini window's button and T: mini.spec.ts.
})

test('a card dragged by its handle in edit mode moves; Esc mid-drag puts it back', async ({
  page,
}) => {
  // Without motion, cards sit in their places at once (no flip or scale while measuring).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('n')
  await page.keyboard.press('e')
  const handle = page.getByRole('button', { name: 'Move Timer', exact: true })
  const target = cardNamed(page, 'Timer 3')

  /** The center of `locator` once it has stopped moving (the grid settles after a drop). */
  const center = async (locator: typeof handle) => {
    let last = ''
    for (;;) {
      const box = await locator.boundingBox()
      if (!box) throw new Error('no box')
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      const key = JSON.stringify(point)
      if (key === last) return point
      last = key
      await page.waitForTimeout(50)
    }
  }

  // Drop on the third card's place: the order becomes Timer 2, Timer 3, Timer.
  let from = await center(handle)
  let to = await center(target)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, to.y, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2', 'Timer 3', 'Timer'])
  await expect(selectedCard(page)).toHaveAccessibleName('Timer')

  // Esc during a drag cancels it: the card goes back where it started.
  from = await center(handle)
  to = await center(cardNamed(page, 'Timer 2'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 2', 'Timer 3'])
  await page.keyboard.press('Escape')
  await expect.poll(() => cardNames(page)).toEqual(['Timer 2', 'Timer 3', 'Timer'])
  await page.mouse.up()
  // The Esc belonged to the drag: edit mode is still on.
  await expect(page.getByRole('textbox', { name: 'Card name' })).toHaveCount(3)
})

test('Undo and Mod+Z stop working once the snackbar times out after 6 seconds', async ({
  page,
}) => {
  await openWithPausedClock(page)
  await page.keyboard.press('n')
  await page.keyboard.press('Delete')
  await expect.poll(() => cardNames(page)).toEqual(['Timer'])
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()

  await page.clock.runFor(5900)
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible()
  await page.clock.runFor(200)
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => cardNames(page)).toEqual(['Timer'])
})

test('undo renumbers a card whose name a newer card took', async ({ page }) => {
  await openApp(page)
  await page.keyboard.press('n')
  await page.keyboard.press('n')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Delete')
  await page.keyboard.press('n')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 3', 'Timer 2'])
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(() => cardNames(page)).toEqual(['Timer', 'Timer 4', 'Timer 3', 'Timer 2'])
  await expect(selectedCard(page)).toHaveAccessibleName('Timer 4')
})

test('a quick-add chip on a running timer extends the time left', async ({ page }) => {
  await openWithPausedClock(page)
  const card = selectedCard(page)
  await page.keyboard.press('Enter')
  await page.clock.runFor(10_000)
  await expect(digitsOf(card)).toHaveText('4:50')
  await card.getByRole('button', { name: '+1:00' }).click()
  await expect(digitsOf(card)).toHaveText('5:50')
  await expect(card).toHaveAttribute('data-phase', 'running')
  await page.clock.runFor(1100)
  await expect(digitsOf(card)).toHaveText('5:49')
})

test('leaving edit mode with the button saves a name still being typed', async ({ page }) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Edit cards' }).click()
  const field = page.getByRole('textbox', { name: 'Card name' })
  await field.fill('Laundry')
  await page.getByRole('button', { name: 'Edit cards' }).click()
  await expect(field).toHaveCount(0)
  await expect(selectedCard(page)).toHaveAccessibleName('Laundry')
  await expect(page.getByRole('heading', { name: 'Laundry' })).toBeVisible()
})
