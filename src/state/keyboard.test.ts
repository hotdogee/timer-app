import { describe, expect, it, vi, type Mock } from 'vitest'

import { cards, digits, keymap, stopwatch, timer, type DigitBuffer, type EpochMs } from '../core'
import { createCardStore, type CardStore } from './cards.svelte'
import {
  createKeyboardController,
  detectKeyPlatform,
  insideDialog,
  isActivatable,
  isTextEntry,
  lastToggledCard,
  ownsArrows,
  type KeyboardDeps,
  type KeyboardEventLike,
} from './keyboard.svelte'

// The store module's app singleton reads ids from the platform layer; keep these tests off it.
vi.mock('../platform', () => ({ platform: { ids: { newId: () => 'first-run' } } }))

const SECOND = 1000
const MINUTE = 60 * SECOND
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

interface Mods {
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
  meta?: boolean
  repeat?: boolean
  target?: unknown
  isComposing?: boolean
  defaultPrevented?: boolean
  altGraph?: boolean
}

/** A fake keydown event that records whether it was prevented. */
function keyEvent(key: string, mods: Mods = {}): KeyboardEventLike & { prevented: boolean } {
  const event = {
    key,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
    repeat: mods.repeat ?? false,
    isComposing: mods.isComposing ?? false,
    defaultPrevented: mods.defaultPrevented ?? false,
    target: mods.target ?? null,
    prevented: false,
    preventDefault() {
      event.prevented = true
    },
    getModifierState(name: string) {
      return name === 'AltGraph' && mods.altGraph === true
    },
  }
  return event
}

/** A minimal element for target checks: tag, type, role, editability and a parent. */
function el(
  tagName: string,
  init: {
    type?: string
    role?: string
    href?: string
    editable?: boolean
    parent?: object
    open?: boolean
  } = {},
): object {
  const attributes: Record<string, string | undefined> = {
    role: init.role,
    href: init.href,
    open: init.open === true ? '' : undefined,
  }
  return {
    tagName,
    type: init.type ?? (tagName === 'INPUT' ? 'text' : ''),
    isContentEditable: init.editable ?? false,
    parentElement: init.parent ?? null,
    getAttribute: (name: string) => attributes[name] ?? null,
  }
}

type Action = () => void
type CardAction = (id: string) => void

/** App actions as mocks. */
interface ActionMocks {
  openPalette: Mock<Action>
  openHelp: Mock<Action>
  openSettings: Mock<Action>
  toggleEditMode: Mock<Action>
  startRename: Mock<CardAction>
  toggleFullscreen: Mock<CardAction>
  miniWindow: Mock<CardAction>
  openPresets: Mock<Action>
  deleteCard: Mock<CardAction>
  undoRemove: Mock<Action>
  cancel: Mock<Action>
}

function actionsMock(): ActionMocks {
  return {
    openPalette: vi.fn<Action>(),
    openHelp: vi.fn<Action>(),
    openSettings: vi.fn<Action>(),
    toggleEditMode: vi.fn<Action>(),
    startRename: vi.fn<CardAction>(),
    toggleFullscreen: vi.fn<CardAction>(),
    miniWindow: vi.fn<CardAction>(),
    openPresets: vi.fn<Action>(),
    deleteCard: vi.fn<CardAction>(),
    undoRemove: vi.fn<Action>(),
    cancel: vi.fn<Action>(),
  }
}

interface Setup {
  store: CardStore
  actions: ActionMocks
  onStart: Mock<CardAction>
  typed: () => DigitBuffer
  setNow: (at: EpochMs) => void
  setColumns: (n: number) => void
  setDialogOpen: (open: boolean) => void
  /** Presses `key` and returns whether the controller called preventDefault. */
  press: (key: string, mods?: Mods) => boolean
  /** Types each character of `text` as a key. */
  type: (text: string) => void
  timerState: (id?: string) => cards.TimerCard['timer'] | undefined
  stopwatchState: (id?: string) => cards.StopwatchCard['stopwatch'] | undefined
  controller: ReturnType<typeof createKeyboardController>
}

function setup(options: { platform?: keymap.Platform; deps?: Partial<KeyboardDeps> } = {}): Setup {
  let now = NOW
  let n = 0
  let typed = digits.EMPTY
  let columns = 2
  let dialog = false
  const store = createCardStore({
    newId: () => `id${++n}`,
    clock: () => NOW - MINUTE,
    bump: () => now,
  })
  const actions = actionsMock()
  // The app's delete, without the confirm-delete setting: at once, through the store.
  actions.deleteCard.mockImplementation((id) => {
    store.remove(id)
  })
  const onStart = vi.fn<CardAction>()
  const controller = createKeyboardController({
    cardStore: store,
    platform: options.platform ?? 'other',
    bindings: keymap.DEFAULT_BINDINGS,
    getColumns: () => columns,
    getTyped: () => typed,
    setTyped: (b) => {
      typed = b
    },
    actions,
    onStart,
    isDialogOpen: () => dialog,
    ...options.deps,
  })
  const press = (key: string, mods?: Mods): boolean => {
    const event = keyEvent(key, mods)
    controller.handleKeydown(event)
    return event.prevented
  }
  const find = (id?: string) => (id === undefined ? store.selected : cards.findCard(store.list, id))
  return {
    store,
    actions,
    onStart,
    typed: () => typed,
    setNow: (at) => {
      now = at
    },
    setColumns: (c) => {
      columns = c
    },
    setDialogOpen: (open) => {
      dialog = open
    },
    press,
    type: (text) => {
      for (const ch of text) press(ch)
    },
    timerState: (id) => {
      const card = find(id)
      return card?.kind === 'timer' ? card.timer : undefined
    },
    stopwatchState: (id) => {
      const card = find(id)
      return card?.kind === 'stopwatch' ? card.stopwatch : undefined
    },
    controller,
  }
}

/** A setup with one selected idle 5:00 timer, 'id1'. */
function withTimer(options?: Parameters<typeof setup>[0]): Setup {
  const s = setup(options)
  s.store.addTimer()
  return s
}

/** A setup with one selected idle stopwatch, 'id1'. */
function withStopwatch(): Setup {
  const s = setup()
  s.store.addStopwatch()
  return s
}

describe('digit entry', () => {
  it('shifts digits into the selected timer’s buffer and prevents their default', () => {
    const s = withTimer()
    expect(s.press('1')).toBe(true)
    s.type('3030')
    expect(s.typed()).toBe('13030')
    expect(digits.formatTyped(s.typed())).toBe('01:30:30')
    // The timer itself is unchanged until an action applies the digits.
    expect(s.timerState()).toEqual(timer.createTimer(5 * MINUTE))
  })

  it('ignores leading zeros and a seventh digit', () => {
    const s = withTimer()
    s.type('00123456')
    expect(s.typed()).toBe('123456')
    s.press('7')
    expect(s.typed()).toBe('123456')
  })

  it('removes the last digit with Backspace', () => {
    const s = withTimer()
    s.type('130')
    expect(s.press('Backspace')).toBe(true)
    expect(s.typed()).toBe('13')
  })

  it('leaves Backspace alone when nothing is typed', () => {
    const s = withTimer()
    expect(s.press('Backspace')).toBe(false)
    expect(s.typed()).toBe('')
  })

  it('repeats held digits and Backspace', () => {
    const s = withTimer()
    s.press('5')
    s.press('5', { repeat: true })
    s.press('5', { repeat: true })
    expect(s.typed()).toBe('555')
    s.press('Backspace', { repeat: true })
    expect(s.typed()).toBe('55')
  })

  it('types a digit that needs Shift (AZERTY digit row)', () => {
    const s = withTimer()
    expect(s.press('4', { shift: true })).toBe(true)
    expect(s.typed()).toBe('4')
  })

  it('does not treat digits with Ctrl, Alt or Meta as typing', () => {
    const s = withTimer()
    expect(s.press('1', { ctrl: true })).toBe(false)
    expect(s.press('2', { alt: true })).toBe(false)
    expect(s.press('3', { meta: true })).toBe(false)
    expect(s.press('Backspace', { ctrl: true })).toBe(false)
    expect(s.typed()).toBe('')
  })

  it('ignores digits on a running timer', () => {
    const s = withTimer()
    s.store.timer('id1', timer.start)
    expect(s.press('5')).toBe(false)
    expect(s.typed()).toBe('')
  })

  it('ignores digits on a stopwatch and with no cards', () => {
    const s = withStopwatch()
    expect(s.press('5')).toBe(false)
    expect(s.typed()).toBe('')
    const empty = setup()
    expect(empty.press('5')).toBe(false)
    expect(empty.typed()).toBe('')
  })

  it('buffers digits on a paused timer; Enter replaces the duration and starts', () => {
    const s = withTimer()
    s.store.timer('id1', timer.start)
    s.setNow(NOW + MINUTE)
    s.store.timer('id1', timer.pause)
    s.type('90')
    expect(s.timerState()?.phase).toBe('paused')
    s.setNow(NOW + 2 * MINUTE)
    s.press('Enter')
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 90 * SECOND,
      endsAt: NOW + 2 * MINUTE + 90 * SECOND,
    })
    expect(s.typed()).toBe('')
  })

  it('dismisses a ringing timer on the first digit; Enter starts the new duration', () => {
    const s = withTimer()
    s.store.timer('id1', (t, now) => timer.start(timer.setDuration(t, SECOND), now))
    s.setNow(NOW + 2 * SECOND)
    s.store.settle(NOW + 2 * SECOND)
    expect(s.timerState()?.phase).toBe('ringing')
    expect(s.press('3')).toBe(true)
    expect(s.timerState()).toEqual({ phase: 'idle', duration: SECOND })
    expect(s.typed()).toBe('3')
    s.press('0')
    s.press('Enter')
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 30 * SECOND,
      endsAt: NOW + 2 * SECOND + 30 * SECOND,
    })
  })

  it('dismisses a ringing timer even on a leading zero', () => {
    const s = withTimer()
    s.store.timer('id1', (t, now) => timer.start(timer.setDuration(t, SECOND), now))
    s.store.settle(NOW + SECOND)
    expect(s.press('0')).toBe(true)
    expect(s.timerState()?.phase).toBe('idle')
    expect(s.typed()).toBe('')
  })
})

describe('Enter (start)', () => {
  it('normalizes typed overflow on start: 90 → 1:30', () => {
    const s = withTimer()
    s.type('90')
    expect(s.press('Enter')).toBe(true)
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 90 * SECOND,
      endsAt: NOW + 90 * SECOND,
    })
    expect(s.typed()).toBe('')
  })

  it('starts an idle timer with nothing typed and reports the start', () => {
    const s = withTimer()
    s.press('Enter')
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 5 * MINUTE,
      endsAt: NOW + 5 * MINUTE,
    })
    expect(s.onStart).toHaveBeenCalledTimes(1)
    expect(s.onStart).toHaveBeenCalledWith('id1')
  })

  it('resumes a paused timer', () => {
    const s = withTimer()
    s.store.timer('id1', timer.start)
    s.setNow(NOW + MINUTE)
    s.store.timer('id1', timer.pause)
    s.setNow(NOW + 10 * MINUTE)
    s.press('Enter')
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 5 * MINUTE,
      endsAt: NOW + 10 * MINUTE + 4 * MINUTE,
    })
    expect(s.onStart).toHaveBeenCalledTimes(1)
  })

  it('dismisses a ringing timer when nothing is typed, without reporting a start', () => {
    const s = withTimer()
    s.store.timer('id1', timer.start)
    s.store.settle(NOW + 5 * MINUTE)
    expect(s.timerState()?.phase).toBe('ringing')
    s.press('Enter')
    expect(s.timerState()).toEqual({ phase: 'idle', duration: 5 * MINUTE })
    expect(s.onStart).not.toHaveBeenCalled()
  })

  it('leaves a running timer running and reports nothing', () => {
    const s = withTimer()
    s.store.timer('id1', timer.start)
    const before = s.timerState()
    s.setNow(NOW + SECOND)
    expect(s.press('Enter')).toBe(true)
    expect(s.timerState()).toBe(before)
    expect(s.onStart).not.toHaveBeenCalled()
  })

  it('starts and resumes a stopwatch without reporting a timer start', () => {
    const s = withStopwatch()
    s.press('Enter')
    expect(s.stopwatchState()).toEqual(stopwatch.start(stopwatch.createStopwatch(), NOW))
    s.setNow(NOW + SECOND)
    s.store.stopwatch('id1', stopwatch.pause)
    s.setNow(NOW + 5 * SECOND)
    s.press('Enter')
    expect(s.stopwatchState()?.phase).toBe('running')
    expect(s.onStart).not.toHaveBeenCalled()
  })

  it('does nothing with no cards', () => {
    const s = setup()
    expect(s.press('Enter')).toBe(true)
    expect(s.store.cards).toEqual([])
  })
})

describe('Space (toggle)', () => {
  it('starts, pauses and resumes a timer', () => {
    const s = withTimer()
    s.press(' ')
    expect(s.timerState()?.phase).toBe('running')
    s.setNow(NOW + MINUTE)
    s.press(' ')
    expect(s.timerState()).toEqual({ phase: 'paused', duration: 5 * MINUTE, remaining: 4 * MINUTE })
    s.press(' ')
    expect(s.timerState()?.phase).toBe('running')
    expect(s.onStart).toHaveBeenCalledTimes(2)
  })

  it('applies typed digits first', () => {
    const s = withTimer()
    s.type('5')
    s.press(' ')
    expect(s.timerState()).toEqual({ phase: 'running', duration: 5 * SECOND, endsAt: NOW + 5000 })
    expect(s.typed()).toBe('')
  })

  it('applies typed digits to a paused timer, resetting it to the new duration', () => {
    const s = withTimer()
    s.press(' ')
    s.setNow(NOW + MINUTE)
    s.press(' ')
    s.type('2')
    s.setNow(NOW + 2 * MINUTE)
    s.press(' ')
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 2 * SECOND,
      endsAt: NOW + 2 * MINUTE + 2 * SECOND,
    })
  })

  it('dismisses a ringing timer', () => {
    const s = withTimer()
    s.press(' ')
    s.store.settle(NOW + 5 * MINUTE)
    s.press(' ')
    expect(s.timerState()).toEqual({ phase: 'idle', duration: 5 * MINUTE })
  })

  it('starts and pauses a stopwatch', () => {
    const s = withStopwatch()
    s.press(' ')
    expect(s.stopwatchState()?.phase).toBe('running')
    s.setNow(NOW + 1234)
    s.press('Spacebar')
    expect(s.stopwatchState()).toEqual({ phase: 'paused', accumulated: 1234, laps: [] })
  })

  it('does not repeat while held, but still keeps the page from scrolling', () => {
    const s = withTimer()
    s.press(' ')
    const running = s.timerState()
    expect(s.press(' ', { repeat: true })).toBe(true)
    expect(s.timerState()).toBe(running)
  })

  it('leaves Space and Enter to a focused button, link, summary or checkbox', () => {
    const targets = [
      el('BUTTON'),
      el('A', { href: '#' }),
      el('SUMMARY'),
      el('INPUT', { type: 'checkbox' }),
      el('DIV', { role: 'button' }),
      el('DIV', { role: 'switch' }),
    ]
    for (const target of targets) {
      const s = withTimer()
      expect(s.press(' ', { target })).toBe(false)
      expect(s.press('Enter', { target })).toBe(false)
      expect(s.timerState()?.phase).toBe('idle')
    }
  })

  it('acts on Space when a card or a plain element has focus', () => {
    for (const target of [el('DIV', { role: 'option' }), el('ARTICLE'), el('BODY'), null]) {
      const s = withTimer()
      s.press(' ', { target })
      expect(s.timerState()?.phase).toBe('running')
    }
  })

  it('still runs other shortcuts while a button has focus', () => {
    const s = withTimer()
    s.press('n', { target: el('BUTTON') })
    expect(s.store.cards).toHaveLength(2)
  })
})

describe('R (reset)', () => {
  it('resets a running timer and a running stopwatch', () => {
    const s = withTimer()
    s.press(' ')
    s.press('r')
    expect(s.timerState()).toEqual({ phase: 'idle', duration: 5 * MINUTE })
    const w = withStopwatch()
    w.press(' ')
    w.press('R') // Caps Lock
    expect(w.stopwatchState()).toEqual({ phase: 'idle' })
  })

  it('discards typed digits instead of applying them', () => {
    const s = withTimer()
    s.type('90')
    s.press('r')
    expect(s.typed()).toBe('')
    expect(s.timerState()).toEqual({ phase: 'idle', duration: 5 * MINUTE })
  })

  it('does not fire with Ctrl (Ctrl+R reloads the page)', () => {
    const s = withTimer()
    s.press(' ')
    expect(s.press('r', { ctrl: true })).toBe(false)
    expect(s.timerState()?.phase).toBe('running')
  })
})

describe('L (lap)', () => {
  it('adds a lap to a running stopwatch', () => {
    const s = withStopwatch()
    s.press(' ')
    s.setNow(NOW + 1500)
    s.press('l')
    s.setNow(NOW + 4000)
    s.press('l')
    expect(s.stopwatchState()).toMatchObject({ phase: 'running', laps: [1500, 4000] })
  })

  it('does nothing on an idle or paused stopwatch, or on a timer', () => {
    const s = withStopwatch()
    s.press('l')
    expect(s.stopwatchState()).toEqual({ phase: 'idle' })
    s.press(' ')
    s.press(' ')
    const paused = s.stopwatchState()
    s.press('l')
    expect(s.stopwatchState()).toBe(paused)
    const t = withTimer()
    const idle = t.timerState()
    t.press('l')
    expect(t.timerState()).toBe(idle)
  })
})

describe('adding and deleting cards', () => {
  it('adds a numbered timer with N and a stopwatch with Shift+N, selecting each', () => {
    const s = withTimer()
    s.press('n')
    expect(s.store.selected?.name).toBe('Timer 2')
    s.press('N', { shift: true })
    expect(s.store.selected).toMatchObject({ kind: 'stopwatch', name: 'Stopwatch' })
    expect(s.store.cards.map((c) => c.name)).toEqual(['Timer', 'Timer 2', 'Stopwatch'])
  })

  it('drops typed digits when a new card takes the selection', () => {
    const s = withTimer()
    s.type('45')
    s.press('n')
    expect(s.typed()).toBe('')
    s.press('Enter')
    expect(s.timerState('id1')).toEqual({ phase: 'idle', duration: 5 * MINUTE })
    expect(s.timerState('id2')?.duration).toBe(5 * MINUTE)
  })

  it('deletes the selected card with Delete, remembering it for undo', () => {
    const s = withTimer()
    s.press('n')
    expect(s.press('Delete')).toBe(true)
    expect(s.actions.deleteCard).toHaveBeenCalledWith('id2')
    expect(s.store.cards.map((c) => c.id)).toEqual(['id1'])
    expect(s.store.lastRemoved).toMatchObject({ card: { id: 'id2' }, index: 1 })
  })

  it('leaves the delete to the app, which may ask first (confirm before delete)', () => {
    const s = withTimer()
    s.actions.deleteCard.mockReset()
    s.press('Delete')
    expect(s.actions.deleteCard).toHaveBeenCalledWith('id1')
    expect(s.store.cards).toHaveLength(1)
  })

  it('does not delete with Backspace, which only edits digits', () => {
    const s = withTimer()
    s.press('Backspace')
    expect(s.store.cards).toHaveLength(1)
    expect(s.store.lastRemoved).toBeNull()
  })

  it('does nothing on Delete with no cards', () => {
    const s = setup()
    s.press('Delete')
    expect(s.actions.deleteCard).not.toHaveBeenCalled()
    expect(s.store.lastRemoved).toBeNull()
  })

  it('asks the app to undo with Mod+Z: Ctrl elsewhere, Cmd on macOS', () => {
    const other = withTimer()
    other.press('z', { ctrl: true })
    expect(other.actions.undoRemove).toHaveBeenCalledTimes(1)
    other.press('z', { meta: true })
    expect(other.actions.undoRemove).toHaveBeenCalledTimes(1)
    const mac = withTimer({ platform: 'mac' })
    mac.press('z', { meta: true })
    mac.press('z', { ctrl: true })
    expect(mac.actions.undoRemove).toHaveBeenCalledTimes(1)
  })
})

describe('card and app shortcuts', () => {
  it('passes the selected card to rename, fullscreen and mini window', () => {
    const s = withTimer()
    s.press('n')
    s.press('F2')
    expect(s.actions.startRename).toHaveBeenCalledWith('id2')
    s.press('f')
    expect(s.actions.toggleFullscreen).toHaveBeenCalledWith('id2')
    s.press('t')
    expect(s.actions.miniWindow).toHaveBeenCalledWith('id2')
  })

  it('skips card shortcuts when there is no card', () => {
    const s = setup()
    for (const key of ['F2', 'f', 't', 'm', 'l', 'r', ' ']) s.press(key)
    expect(s.actions.startRename).not.toHaveBeenCalled()
    expect(s.actions.toggleFullscreen).not.toHaveBeenCalled()
    expect(s.actions.miniWindow).not.toHaveBeenCalled()
  })

  it('toggles mute on the selected card with M', () => {
    const s = withTimer()
    s.press('m')
    expect(s.store.selected?.muted).toBe(true)
    s.press('m')
    expect(s.store.selected?.muted).toBe(false)
  })

  it('opens the palette, help and presets, and toggles edit mode', () => {
    const s = withTimer()
    s.press('k', { ctrl: true })
    expect(s.actions.openPalette).toHaveBeenCalledTimes(1)
    s.press('?', { shift: true })
    s.press('?')
    expect(s.actions.openHelp).toHaveBeenCalledTimes(2)
    s.press('p')
    expect(s.actions.openPresets).toHaveBeenCalledTimes(1)
    s.press('e')
    expect(s.actions.toggleEditMode).toHaveBeenCalledTimes(1)
  })

  it('opens the settings with Mod+, (Ctrl elsewhere, Cmd on macOS)', () => {
    const other = withTimer()
    expect(other.press(',', { ctrl: true })).toBe(true)
    expect(other.actions.openSettings).toHaveBeenCalledTimes(1)
    other.press(',')
    other.press(',', { meta: true })
    expect(other.actions.openSettings).toHaveBeenCalledTimes(1)
    const mac = withTimer({ platform: 'mac' })
    mac.press(',', { meta: true })
    mac.press(',', { ctrl: true })
    expect(mac.actions.openSettings).toHaveBeenCalledTimes(1)
  })

  it('does not open the settings while a dialog is open or a field has focus', () => {
    const s = withTimer()
    s.setDialogOpen(true)
    s.press(',', { ctrl: true })
    s.setDialogOpen(false)
    s.press(',', { ctrl: true, target: el('INPUT') })
    expect(s.actions.openSettings).not.toHaveBeenCalled()
  })

  it('opens the palette with Cmd+K on macOS', () => {
    const s = withTimer({ platform: 'mac' })
    s.press('k', { ctrl: true })
    expect(s.actions.openPalette).not.toHaveBeenCalled()
    s.press('K', { meta: true })
    expect(s.actions.openPalette).toHaveBeenCalledTimes(1)
  })

  it('reads AltGr (Ctrl+Alt) as no modifier, so ? typed with AltGr opens help', () => {
    const s = withTimer()
    s.press('?', { ctrl: true, alt: true, altGraph: true })
    expect(s.actions.openHelp).toHaveBeenCalledTimes(1)
    // Real Ctrl+Alt is still a modifier combo with no binding.
    expect(s.press('?', { ctrl: true, alt: true })).toBe(false)
  })

  it('does not repeat held shortcuts other than the arrows', () => {
    const s = withTimer()
    s.press('n', { repeat: true })
    s.press('e', { repeat: true })
    expect(s.store.cards).toHaveLength(1)
    expect(s.actions.toggleEditMode).not.toHaveBeenCalled()
  })

  it('leaves unbound keys alone', () => {
    const s = withTimer()
    expect(s.press('x')).toBe(false)
    expect(s.press('Tab')).toBe(false)
    expect(s.press('Shift', { shift: true })).toBe(false)
  })
})

describe('Esc (cancel)', () => {
  it('first clears typed digits, restoring the duration, then asks the app to cancel', () => {
    const s = withTimer()
    s.type('12')
    expect(s.press('Escape')).toBe(true)
    expect(s.typed()).toBe('')
    expect(s.actions.cancel).not.toHaveBeenCalled()
    expect(s.timerState()).toEqual({ phase: 'idle', duration: 5 * MINUTE })
    s.press('Escape')
    expect(s.actions.cancel).toHaveBeenCalledTimes(1)
  })

  it('accepts the legacy Esc key name', () => {
    const s = withTimer()
    s.press('Esc')
    expect(s.actions.cancel).toHaveBeenCalledTimes(1)
  })
})

describe('arrows', () => {
  /** Six timers, 'id1' … 'id6', with 'id1' selected. */
  function grid(): Setup {
    const s = setup()
    for (let i = 0; i < 6; i++) s.store.addTimer()
    s.store.select('id1')
    return s
  }

  it('moves the selection by grid geometry, reading the columns on each press', () => {
    const s = grid()
    s.setColumns(3)
    s.press('ArrowRight')
    expect(s.store.selected?.id).toBe('id2')
    s.press('ArrowDown')
    expect(s.store.selected?.id).toBe('id5')
    s.setColumns(2)
    s.press('ArrowUp')
    expect(s.store.selected?.id).toBe('id3')
    s.press('ArrowLeft')
    expect(s.store.selected?.id).toBe('id2')
  })

  it('repeats while held', () => {
    const s = grid()
    s.press('ArrowRight')
    s.press('ArrowRight', { repeat: true })
    s.press('ArrowRight', { repeat: true })
    expect(s.store.selected?.id).toBe('id4')
  })

  it('drops typed digits when the selection moves', () => {
    const s = grid()
    s.type('7')
    s.press('ArrowRight')
    expect(s.typed()).toBe('')
  })

  it('keeps typed digits when the selection cannot move', () => {
    const s = grid()
    s.type('7')
    s.press('ArrowLeft')
    expect(s.typed()).toBe('7')
  })

  it('moves the selected card with Ctrl+Arrow, keeping it selected', () => {
    const s = grid()
    s.setColumns(3)
    s.press('ArrowRight', { ctrl: true })
    expect(s.store.cards.map((c) => c.id)).toEqual(['id2', 'id1', 'id3', 'id4', 'id5', 'id6'])
    expect(s.store.selected?.id).toBe('id1')
    s.press('ArrowDown', { ctrl: true })
    expect(s.store.cards.map((c) => c.id)).toEqual(['id2', 'id3', 'id4', 'id5', 'id1', 'id6'])
    s.press('ArrowUp', { ctrl: true, repeat: true })
    expect(s.store.cards.map((c) => c.id)).toEqual(['id2', 'id1', 'id3', 'id4', 'id5', 'id6'])
    s.press('ArrowLeft', { ctrl: true })
    s.press('ArrowLeft', { ctrl: true })
    expect(s.store.cards.map((c) => c.id)).toEqual(['id1', 'id2', 'id3', 'id4', 'id5', 'id6'])
  })

  it('does not move a card past the edges of the grid', () => {
    const s = grid()
    s.setColumns(4)
    const before = s.store.list
    s.press('ArrowUp', { ctrl: true })
    s.press('ArrowLeft', { ctrl: true })
    expect(s.store.list).toBe(before)
  })

  it('leaves the arrows to a focused slider or radio button', () => {
    const s = grid()
    for (const target of [el('INPUT', { type: 'range' }), el('DIV', { role: 'slider' })]) {
      expect(s.press('ArrowRight', { target })).toBe(false)
    }
    expect(s.press('ArrowRight', { target: el('INPUT', { type: 'radio' }) })).toBe(false)
    expect(s.store.selected?.id).toBe('id1')
  })
})

describe('when shortcuts are ignored', () => {
  it('ignores every key, Esc and digits included, while a text field has focus', () => {
    const targets = [
      el('INPUT'),
      el('INPUT', { type: 'search' }),
      el('INPUT', { type: 'number' }),
      el('TEXTAREA'),
      el('SELECT'),
      el('DIV', { editable: true }),
      el('DIV', { role: 'textbox' }),
      el('INPUT', { role: 'combobox' }),
    ]
    for (const target of targets) {
      const s = withTimer()
      for (const key of ['1', 'Backspace', 'n', ' ', 'Enter', 'Escape', 'Delete', 'ArrowLeft']) {
        expect(s.press(key, { target })).toBe(false)
      }
      expect(s.press('k', { ctrl: true, target })).toBe(false)
      expect(s.typed()).toBe('')
      expect(s.store.cards).toHaveLength(1)
      expect(s.actions.cancel).not.toHaveBeenCalled()
      expect(s.actions.openPalette).not.toHaveBeenCalled()
    }
  })

  it('ignores every key while a dialog is open, Esc included', () => {
    const s = withTimer()
    s.setDialogOpen(true)
    for (const key of ['5', 'n', 'Escape', '?', 'Delete']) expect(s.press(key)).toBe(false)
    expect(s.typed()).toBe('')
    expect(s.store.cards).toHaveLength(1)
    expect(s.actions.cancel).not.toHaveBeenCalled()
    s.setDialogOpen(false)
    s.press('n')
    expect(s.store.cards).toHaveLength(2)
  })

  it('ignores keys from inside an open dialog element', () => {
    const s = withTimer()
    const dialog = el('DIALOG', { open: true })
    const option = el('LI', { role: 'option', parent: el('UL', { parent: dialog }) })
    expect(s.press('Enter', { target: option })).toBe(false)
    expect(s.press('n', { target: dialog })).toBe(false)
    expect(s.timerState()?.phase).toBe('idle')
  })

  it('takes a key pressed right after a dialog closed, while focus is still inside it', () => {
    const s = withTimer()
    const button = el('BUTTON', { parent: el('DIALOG') })
    expect(s.press('n', { target: button })).toBe(true)
    expect(s.store.cards).toHaveLength(2)
  })

  it('ignores events another handler prevented, and IME composition', () => {
    const s = withTimer()
    expect(s.press('n', { defaultPrevented: true })).toBe(false)
    expect(s.press('n', { isComposing: true })).toBe(false)
    expect(s.press('Process')).toBe(false)
    expect(s.store.cards).toHaveLength(1)
  })

  it('looks for an open <dialog> in the document by default', () => {
    const s = withTimer({ deps: { isDialogOpen: undefined } })
    // No document under Node: nothing counts as open.
    s.press('n')
    expect(s.store.cards).toHaveLength(2)
  })
})

describe('bindings', () => {
  it('reads the bindings on every key press', () => {
    let bindings: keymap.Bindings = keymap.DEFAULT_BINDINGS
    const s = withTimer()
    const c = createKeyboardController({
      cardStore: s.store,
      platform: 'other',
      get bindings() {
        return bindings
      },
      getColumns: () => 1,
      getTyped: () => '',
      setTyped: () => undefined,
      actions: actionsMock(),
    })
    const press = (key: string): boolean => {
      const event = keyEvent(key)
      c.handleKeydown(event)
      return event.prevented
    }
    bindings = { ...keymap.DEFAULT_BINDINGS, toggle: ['k'] }
    expect(press(' ')).toBe(false)
    expect(s.timerState()?.phase).toBe('idle')
    press('k')
    expect(s.timerState()?.phase).toBe('running')
  })

  it('keeps digits and Backspace for typing whatever the bindings say', () => {
    const s = setup({ deps: { bindings: { ...keymap.DEFAULT_BINDINGS, newTimer: ['1'] } } })
    s.store.addTimer()
    s.press('1')
    expect(s.store.cards).toHaveLength(1)
    expect(s.typed()).toBe('1')
  })

  it('runs the dismiss action when it is bound', () => {
    const s = setup({ deps: { bindings: { ...keymap.DEFAULT_BINDINGS, dismiss: ['d'] } } })
    s.store.addTimer(SECOND)
    s.press(' ')
    s.store.settle(NOW + SECOND)
    s.press('d')
    expect(s.timerState()).toEqual({ phase: 'idle', duration: SECOND })
  })
})

describe('typed digits follow the selection', () => {
  it('drops digits typed for another card that a click selected since', () => {
    const s = withTimer()
    s.store.addTimer()
    s.store.select('id1')
    s.type('15')
    s.store.select('id2') // a click elsewhere
    s.press('2')
    expect(s.typed()).toBe('2')
    s.press('Enter')
    expect(s.timerState('id1')).toEqual({ phase: 'idle', duration: 5 * MINUTE })
    expect(s.timerState('id2')).toEqual({
      phase: 'running',
      duration: 2 * SECOND,
      endsAt: NOW + 2 * SECOND,
    })
  })

  it('drops digits when a button starts the timer, so a running timer never has digits', () => {
    const s = withTimer()
    s.type('15')
    s.store.timer('id1', timer.start) // the Start button
    s.press('Escape')
    expect(s.typed()).toBe('')
    expect(s.actions.cancel).toHaveBeenCalledTimes(1)
  })

  it('drops digits when the selected card turns out not to take them', () => {
    const s = withTimer()
    let typed = '42'
    const c = createKeyboardController({
      cardStore: s.store,
      platform: 'other',
      bindings: keymap.DEFAULT_BINDINGS,
      getColumns: () => 1,
      getTyped: () => typed,
      setTyped: (b) => {
        typed = b
      },
      actions: actionsMock(),
    })
    s.store.timer('id1', timer.start)
    c.handleKeydown(keyEvent('x'))
    expect(typed).toBe('')
    c.destroy()
  })

  it('keeps digits across shortcuts that leave the card alone', () => {
    const s = withTimer()
    s.type('3')
    s.press('m')
    s.press('k', { ctrl: true })
    expect(s.typed()).toBe('3')
  })
})

describe('toggleLast (the global hotkey and the tray)', () => {
  it('starts and pauses the selected card when no card was used yet', () => {
    const s = withTimer()
    s.controller.toggleLast()
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 5 * MINUTE,
      endsAt: NOW + 5 * MINUTE,
    })
    expect(s.onStart).toHaveBeenCalledWith('id1')
    s.setNow(NOW + MINUTE)
    s.controller.toggleLast()
    expect(s.timerState()).toEqual({ phase: 'paused', duration: 5 * MINUTE, remaining: 4 * MINUTE })
  })

  it('keeps acting on the card it toggled after the selection moved', () => {
    const s = withTimer()
    s.store.addStopwatch()
    s.store.select('id2')
    s.controller.toggleLast()
    expect(s.stopwatchState('id2')?.phase).toBe('running')
    s.store.select('id1')
    s.controller.toggleLast()
    expect(s.stopwatchState('id2')?.phase).toBe('paused')
    expect(s.timerState('id1')?.phase).toBe('idle')
  })

  it('ignores typed digits and dismisses a ringing timer', () => {
    const s = withTimer()
    s.store.timer('id1', timer.start)
    s.store.settle(NOW + 6 * MINUTE)
    expect(s.timerState()?.phase).toBe('ringing')
    s.controller.toggleLast()
    expect(s.timerState()).toEqual({ phase: 'idle', duration: 5 * MINUTE })

    s.type('3')
    s.controller.toggleLast()
    expect(s.timerState()).toEqual({
      phase: 'running',
      duration: 5 * MINUTE,
      endsAt: NOW + 5 * MINUTE,
    })
  })

  it('falls back to the selected card when the last-used one was deleted, and to nothing', () => {
    const s = withTimer()
    s.store.addTimer()
    s.controller.toggleLast() // id2, selected
    s.store.remove('id2')
    s.controller.toggleLast()
    expect(s.timerState('id1')?.phase).toBe('running')
    s.store.remove('id1')
    expect(() => {
      s.controller.toggleLast()
    }).not.toThrow()
    expect(s.store.cards).toEqual([])
  })
})

describe('lastToggledCard', () => {
  it('finds the card that started, resumed or paused, and nothing for other changes', () => {
    const s = withTimer()
    s.store.addStopwatch()
    const idle = s.store.list
    s.store.timer('id1', timer.start)
    const started = s.store.list
    expect(lastToggledCard(idle, started)).toBe('id1')
    expect(lastToggledCard(started, started)).toBeNull()
    s.store.rename('id1', 'Tea')
    expect(lastToggledCard(started, s.store.list)).toBeNull()
    const renamed = s.store.list
    s.store.timer('id1', timer.pause)
    expect(lastToggledCard(renamed, s.store.list)).toBe('id1')
    const paused = s.store.list
    s.store.timer('id1', timer.reset)
    expect(lastToggledCard(paused, s.store.list)).toBeNull()
    s.store.stopwatch('id2', stopwatch.start)
    expect(lastToggledCard(paused, s.store.list)).toBe('id2')
  })

  it('counts a card that arrives running, and takes the last in grid order', () => {
    const s = withTimer()
    s.store.addTimer()
    s.store.timer('id1', timer.start)
    s.store.timer('id2', timer.start)
    expect(lastToggledCard(cards.EMPTY_LIST, s.store.list)).toBe('id2')
  })
})

describe('destroy', () => {
  it('can be called more than once', () => {
    const s = withTimer()
    s.controller.destroy()
    s.controller.destroy()
    s.press('n')
    expect(s.store.cards).toHaveLength(2)
  })
})

describe('target checks', () => {
  it('recognizes text fields', () => {
    expect(isTextEntry(el('INPUT'))).toBe(true)
    expect(isTextEntry(el('input', { type: 'EMAIL' }))).toBe(true)
    expect(isTextEntry(el('INPUT', { type: '' }))).toBe(true)
    expect(isTextEntry(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTextEntry(el('INPUT', { type: 'range' }))).toBe(false)
    expect(isTextEntry(el('BUTTON'))).toBe(false)
    expect(isTextEntry(el('DIV', { role: 'searchbox' }))).toBe(true)
    expect(isTextEntry(null)).toBe(false)
    expect(isTextEntry('INPUT')).toBe(false)
    expect(isTextEntry({})).toBe(false)
  })

  it('recognizes controls that own Space and Enter', () => {
    expect(isActivatable(el('BUTTON'))).toBe(true)
    expect(isActivatable(el('A', { href: '/x' }))).toBe(true)
    expect(isActivatable(el('A'))).toBe(false)
    expect(isActivatable(el('DIV', { role: 'menuitem' }))).toBe(true)
    expect(isActivatable(el('DIV', { role: 'option' }))).toBe(false)
    expect(isActivatable(el('DIV'))).toBe(false)
    expect(isActivatable(undefined)).toBe(false)
  })

  it('recognizes controls that own the arrows', () => {
    expect(ownsArrows(el('INPUT', { type: 'range' }))).toBe(true)
    expect(ownsArrows(el('INPUT', { type: 'radio' }))).toBe(true)
    expect(ownsArrows(el('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(ownsArrows(el('DIV', { role: 'spinbutton' }))).toBe(true)
    expect(ownsArrows(el('DIV', { role: 'listbox' }))).toBe(false)
    expect(ownsArrows(null)).toBe(false)
  })

  it('finds an open dialog among the ancestors', () => {
    const dialog = el('DIALOG', { open: true })
    expect(insideDialog(dialog)).toBe(true)
    expect(insideDialog(el('SPAN', { parent: el('DIV', { parent: dialog }) }))).toBe(true)
    expect(insideDialog(el('SPAN', { parent: el('MAIN') }))).toBe(false)
    expect(insideDialog(null)).toBe(false)
  })

  it('does not count a closed dialog, where focus can linger for a frame', () => {
    const closed = el('DIALOG')
    expect(insideDialog(closed)).toBe(false)
    expect(insideDialog(el('BUTTON', { parent: closed }))).toBe(false)
  })

  it('stops walking a cyclic parent chain', () => {
    const a: { tagName: string; parentElement: unknown } = { tagName: 'DIV', parentElement: null }
    a.parentElement = a
    expect(insideDialog(a)).toBe(false)
  })
})

describe('detectKeyPlatform', () => {
  it('reads macOS, iOS and iPadOS as mac', () => {
    expect(detectKeyPlatform({ platform: 'MacIntel' })).toBe('mac')
    expect(detectKeyPlatform({ platform: 'iPhone' })).toBe('mac')
    expect(detectKeyPlatform({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe(
      'mac',
    )
    expect(detectKeyPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(
      'mac',
    )
  })

  it('reads everything else, and unknown, as other', () => {
    expect(detectKeyPlatform({ platform: 'Win32' })).toBe('other')
    expect(detectKeyPlatform({ userAgentData: { platform: '' }, platform: 'Linux x86_64' })).toBe(
      'other',
    )
    expect(detectKeyPlatform({})).toBe('other')
    expect(detectKeyPlatform(undefined)).toBe('other')
  })
})
