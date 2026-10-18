/**
 * The mini window's card and page in jsdom with Svelte's browser runtime, on the app's card store:
 * the buttons for each phase, the keys (Space, Enter, R, L, Esc), the pin, a deleted card closing
 * the window, announcements on the desktop page, and the page switching cards and titling itself.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { cards, timer } from '../../core'
import { setAppLocale } from '../../i18n'
import type { MiniWindowController } from '../../platform'
import { cardStore } from '../../state/cards.svelte'
import { settingsStore } from '../../state/settings.svelte'
import { announce, currentAnnouncement } from '../announce.svelte'
import MiniApp from './MiniApp.svelte'
import MiniCard from './MiniCard.svelte'
import { openMiniWindow } from './open'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  cardStore.replace(cards.EMPTY_LIST)
  settingsStore.resetDesktop()
  setAppLocale('en')
  vi.useRealTimers()
})

async function settle() {
  for (let i = 0; i < 4; i++) {
    await tick()
    await Promise.resolve()
  }
  flushSync()
}

function text(root: Element): string {
  return root.textContent.replace(/\s+/g, ' ').trim()
}

/** The accessible names of the card's buttons, in order. */
function controls(root: ParentNode): string[] {
  return [...root.querySelectorAll('.controls button')].map(
    (b) => b.getAttribute('aria-label') ?? b.textContent.trim(),
  )
}

function press(key: string, init: KeyboardEventInit = {}) {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  )
  flushSync()
}

function useCards(...list: cards.Card[]) {
  cardStore.replace({ cards: list, selectedId: list[0]?.id ?? null })
}

function card(id = 'c1'): cards.Card {
  const found = cards.findCard(cardStore.list, id)
  if (found === undefined) throw new Error(`No card ${id}`)
  return found
}

/** Card c1's timer state. */
function timerState() {
  const found = card()
  if (found.kind !== 'timer') throw new Error('Not a timer')
  return found.timer
}

/** Card c1's stopwatch state. */
function stopwatchState() {
  const found = card()
  if (found.kind !== 'stopwatch') throw new Error('Not a stopwatch')
  return found.stopwatch
}

async function setup(props: { pinnable?: boolean; announceChanges?: boolean } = {}) {
  const onclose = vi.fn()
  const target = document.createElement('div')
  document.body.append(target)
  const view = mount(MiniCard, { target, props: { cardId: 'c1', onclose, ...props } })
  cleanups.push(() => {
    void unmount(view)
    target.remove()
  })
  await settle()
  return { target, onclose }
}

describe('MiniCard', () => {
  it('shows an idle timer with Start and +1:00', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0, 180_000))
    const { target } = await setup()
    expect(target.querySelector('h1')?.textContent).toBe('Tea')
    expect(target.querySelector('[role="timer"]')?.textContent).toBe('3:00')
    expect(controls(target)).toEqual(['Start', '+1:00'])
  })

  it('runs the card from its buttons', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0, 180_000))
    const { target } = await setup()
    ;[...target.querySelectorAll<HTMLButtonElement>('.controls button')][1]?.click()
    await settle()
    expect(timerState().duration).toBe(240_000)
    target.querySelector<HTMLButtonElement>('.controls button')?.click()
    await settle()
    expect(controls(target)).toEqual(['Pause', 'Reset', '+1:00'])
    expect(timerState().phase).toBe('running')
  })

  it('answers Space, R and Esc', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0, 180_000))
    const { onclose } = await setup()
    press(' ')
    expect(timerState().phase).toBe('running')
    press(' ')
    expect(timerState().phase).toBe('paused')
    press('r')
    expect(timerState().phase).toBe('idle')
    press('Escape')
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('dismisses a ringing timer with Enter, and leaves keys to a focused button', async () => {
    const base = cards.createTimerCard('c1', 'Tea', 0, 1000)
    const now = Date.now()
    useCards({ ...base, timer: timer.settle(timer.start(base.timer, now - 5000), now) })
    const { target } = await setup()
    expect(controls(target)).toEqual(['Dismiss', 'Restart'])
    target.querySelector<HTMLButtonElement>('.controls button')?.focus()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    target.querySelector('.controls button')?.dispatchEvent(event)
    flushSync()
    expect(event.defaultPrevented).toBe(false)
    expect(timerState().phase).toBe('ringing')
    ;(document.activeElement as HTMLElement | null)?.blur()
    press('Enter')
    expect(timerState().phase).toBe('idle')
  })

  it('runs a stopwatch, with Lap', async () => {
    useCards(cards.createStopwatchCard('c1', 'Run', 0))
    const { target } = await setup()
    expect(controls(target)).toEqual(['Start'])
    press(' ')
    expect(controls(target)).toEqual(['Pause', 'Lap', 'Reset'])
    press('l')
    const state = stopwatchState()
    expect(state.phase === 'running' ? state.laps.length : 0).toBe(1)
  })

  it('pins the window on top, on desktop only', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0))
    const plain = await setup()
    expect(plain.target.querySelector('.pin')).toBeNull()
    const { target } = await setup({ pinnable: true })
    const pin = target.querySelector<HTMLButtonElement>('.pin')
    expect(pin?.getAttribute('aria-label')).toBe('Keep on top')
    expect(pin?.getAttribute('aria-pressed')).toBe('true')
    pin?.click()
    await settle()
    expect(settingsStore.desktop.miniAlwaysOnTop).toBe(false)
    expect(pin?.getAttribute('aria-pressed')).toBe('false')
  })

  it('says a deleted card was deleted and closes after two seconds, unless it comes back', async () => {
    vi.useFakeTimers()
    const tea = cards.createTimerCard('c1', 'Tea', 0)
    useCards(tea)
    const { target, onclose } = await setup()
    cardStore.remove('c1')
    await settle()
    expect(text(target)).toContain('This card was deleted')
    expect(target.querySelector('h1')?.textContent).toBe('Tea')
    vi.advanceTimersByTime(1000)
    cardStore.undoRemove()
    await settle()
    vi.advanceTimersByTime(5000)
    expect(onclose).not.toHaveBeenCalled()
    cardStore.remove('c1')
    await settle()
    vi.advanceTimersByTime(2000)
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('announces the card’s changes on the desktop page', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0, 180_000))
    await setup({ announceChanges: true })
    press(' ')
    await settle()
    expect(currentAnnouncement()).toBe('Tea started, 3:00')
  })

  it('says through the live region, on the desktop page, that its card was deleted', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0, 180_000))
    await setup({ announceChanges: true })
    press(' ')
    await settle()
    cardStore.remove('c1')
    await settle()
    expect(currentAnnouncement()).toBe('This card was deleted')
  })

  it('leaves announcing a deletion to the app in Picture-in-Picture', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0, 180_000))
    await setup()
    announce('Tea deleted')
    cardStore.remove('c1')
    await settle()
    expect(currentAnnouncement()).toBe('Tea deleted')
  })
})

describe('MiniApp', () => {
  it('shows the card of its address, follows switches and titles the window', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0), cards.createTimerCard('c2', 'Eggs', 0))
    let switchTo: (id: string) => void = () => undefined
    const onclose = vi.fn()
    const target = document.createElement('div')
    document.body.append(target)
    const view = mount(MiniApp, {
      target,
      props: {
        cardId: 'c1',
        onswitch: (listener: (id: string) => void) => {
          switchTo = listener
          return () => undefined
        },
        onclose,
        pinnable: true,
      },
    })
    cleanups.push(() => {
      void unmount(view)
      target.remove()
    })
    await settle()
    expect(target.querySelector('h1')?.textContent).toBe('Tea')
    expect(document.title).toBe('Tea – Mini window')
    switchTo('c2')
    await settle()
    expect(target.querySelector('h1')?.textContent).toBe('Eggs')
    expect(document.title).toBe('Eggs – Mini window')
    target.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.click()
    expect(onclose).toHaveBeenCalled()
  })

  it('says the card was deleted when the address names none', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const view = mount(MiniApp, {
      target,
      props: { cardId: null, onswitch: () => () => undefined, onclose: () => undefined },
    })
    cleanups.push(() => {
      void unmount(view)
      target.remove()
    })
    await settle()
    expect(text(target)).toContain('This card was deleted')
    // The window still has a name for its landmark and heading.
    expect(target.querySelector('h1')?.textContent).toBe('Mini window')
  })

  it('offers no pin in a plain browser tab', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0))
    const target = document.createElement('div')
    document.body.append(target)
    const view = mount(MiniApp, {
      target,
      props: { cardId: 'c1', onswitch: () => () => undefined, onclose: () => undefined },
    })
    cleanups.push(() => {
      void unmount(view)
      target.remove()
    })
    await settle()
    expect(target.querySelector('button[aria-label="Keep on top"]')).toBeNull()
  })
})

describe('openMiniWindow', () => {
  function fakeWindows(supported: boolean) {
    return {
      supported,
      isOpen: () => false,
      open: vi.fn<MiniWindowController['open']>(() => Promise.resolve()),
      close: () => Promise.resolve(),
      setAlwaysOnTop: () => Promise.resolve(),
      onChange: () => () => undefined,
    }
  }

  it('opens the card through the platform, on top as the setting says', async () => {
    const windows = fakeWindows(true)
    await openMiniWindow('c1', { windows, alwaysOnTop: () => false })
    expect(windows.open).toHaveBeenCalledWith('c1', expect.any(Function), { alwaysOnTop: false })
    await openMiniWindow('c2', { windows })
    expect(windows.open).toHaveBeenLastCalledWith('c2', expect.any(Function), {
      alwaysOnTop: true,
    })
  })

  it('does nothing without a mini window', async () => {
    const windows = fakeWindows(false)
    await openMiniWindow('c1', { windows })
    expect(windows.open).not.toHaveBeenCalled()
  })

  it('draws the card into a Picture-in-Picture document and removes it again', async () => {
    useCards(cards.createTimerCard('c1', 'Tea', 0))
    const windows = fakeWindows(true)
    await openMiniWindow('c1', { windows })
    const render = windows.open.mock.calls[0]?.[1]
    if (render === undefined) throw new Error('Nothing was opened')
    const target = document.createElement('div')
    document.body.append(target)
    const cleanup = render(target, 'c1')
    await settle()
    expect(target.querySelector('h1')?.textContent).toBe('Tea')
    expect(target.querySelector('.pin')).toBeNull()
    cleanup()
    await settle()
    expect(target.querySelector('.mini')).toBeNull()
    target.remove()
  })
})
