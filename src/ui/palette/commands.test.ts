import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import { cards, digits, stopwatch, timer, type DigitBuffer, type EpochMs } from '../../core'
import { setAppLocale } from '../../i18n'
import { createCardStore, type CardStore } from '../../state/cards.svelte'
import {
  buildCommands,
  digitCommand,
  paletteResults,
  type Command,
  type CommandContext,
} from './commands'

vi.mock('../../platform', () => ({ platform: { ids: { newId: () => 'first-run' } } }))

const SECOND = 1000
const MINUTE = 60 * SECOND
const NOW = Date.UTC(2026, 9, 17, 14, 47, 0)

const PRESETS = [
  { id: 'tea', name: 'Tea', duration: 3 * MINUTE },
  { id: 'pomodoro', name: 'Pomodoro', duration: 25 * MINUTE },
]

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

function setup(extra: Partial<CommandContext> = {}): {
  store: CardStore
  actions: ActionMocks
  onStart: Mock<CardAction>
  ctx: CommandContext
  setNow: (at: EpochMs) => void
} {
  let now = NOW
  let n = 0
  const store = createCardStore({ newId: () => `id${++n}`, clock: () => NOW, bump: () => now })
  const actions: ActionMocks = {
    openPalette: vi.fn<Action>(),
    openHelp: vi.fn<Action>(),
    openSettings: vi.fn<Action>(),
    toggleEditMode: vi.fn<Action>(),
    startRename: vi.fn<CardAction>(),
    toggleFullscreen: vi.fn<CardAction>(),
    miniWindow: vi.fn<CardAction>(),
    openPresets: vi.fn<Action>(),
    // The app's delete without the confirm-delete setting: at once, through the store.
    deleteCard: vi.fn<CardAction>((id) => {
      store.remove(id)
    }),
    undoRemove: vi.fn<Action>(),
    cancel: vi.fn<Action>(),
  }
  const onStart = vi.fn<CardAction>()
  return {
    store,
    actions,
    onStart,
    ctx: { cardStore: store, actions, presets: PRESETS, onStart, ...extra },
    setNow: (at) => {
      now = at
    },
  }
}

/** The commands that apply now, by id. */
function visible(ctx: CommandContext): Map<string, Command> {
  return new Map(
    buildCommands(ctx)
      .filter((c) => c.when !== false)
      .map((c) => [c.id, c]),
  )
}

function get(ctx: CommandContext, id: string): Command {
  const command = visible(ctx).get(id)
  if (command === undefined) throw new Error(`no visible command ${id}`)
  return command
}

describe('buildCommands', () => {
  it('lists new cards, presets, edit mode and help with no card selected', () => {
    const { ctx } = setup()
    expect([...visible(ctx).keys()]).toEqual([
      'new-timer',
      'new-stopwatch',
      'preset-0',
      'preset-1',
      'edit-mode',
      'help',
      'settings',
    ])
  })

  it('gives every command a title and every shortcut a real action', () => {
    const { ctx, store } = setup()
    store.addTimer()
    for (const command of buildCommands(ctx)) {
      expect(command.title.trim()).not.toBe('')
    }
    const shortcuts = buildCommands(ctx).flatMap((c) => (c.shortcut ? [c.shortcut] : []))
    expect(shortcuts).toContain('toggle')
    expect(shortcuts).toContain('deleteCard')
  })

  it('keeps ids unique', () => {
    const { ctx, store } = setup()
    store.addTimer()
    store.remove('id1')
    store.addStopwatch()
    const ids = buildCommands(ctx).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('puts the selected card’s actions first, with its name as the hint', () => {
    const { ctx, store } = setup()
    store.addTimer()
    store.rename('id1', 'Tea time')
    const list = buildCommands(ctx).filter((c) => c.when !== false)
    expect(list.slice(0, 5).map((c) => c.id)).toEqual([
      'toggle',
      'mute',
      'rename',
      'fullscreen',
      'delete',
    ])
    expect(list[0]).toMatchObject({ title: 'Start', hint: 'Tea time', shortcut: 'toggle' })
  })

  it('names the timer toggle after the phase and offers Restart and Reset when they apply', () => {
    const { ctx, store, setNow } = setup()
    store.addTimer(MINUTE)
    expect(get(ctx, 'toggle').title).toBe('Start')
    expect(visible(ctx).has('reset')).toBe(false)
    store.timer('id1', timer.start)
    expect(get(ctx, 'toggle').title).toBe('Pause')
    expect(visible(ctx).has('reset')).toBe(true)
    setNow(NOW + SECOND)
    store.timer('id1', timer.pause)
    expect(get(ctx, 'toggle').title).toBe('Resume')
    store.timer('id1', timer.start)
    store.settle(NOW + 2 * MINUTE)
    expect(get(ctx, 'toggle').title).toBe('Dismiss')
    expect(visible(ctx).has('restart')).toBe(true)
  })

  it('hides Start for a timer set to zero', () => {
    const { ctx, store } = setup()
    store.addTimer(0)
    expect(visible(ctx).has('toggle')).toBe(false)
  })

  it('runs the timer toggle and reports starts', () => {
    const { ctx, store, onStart } = setup()
    store.addTimer()
    get(ctx, 'toggle').run()
    expect(store.selected).toMatchObject({ timer: { phase: 'running', endsAt: NOW + 5 * MINUTE } })
    expect(onStart).toHaveBeenCalledWith('id1')
    get(ctx, 'toggle').run()
    expect(store.selected).toMatchObject({ timer: { phase: 'paused' } })
    get(ctx, 'reset').run()
    expect(store.selected).toMatchObject({ timer: { phase: 'idle', duration: 5 * MINUTE } })
  })

  it('applies typed digits before Start, as Space does, and clears them', () => {
    let typed: DigitBuffer = '90'
    const takeTyped = (): DigitBuffer => {
      const buffer = typed
      typed = digits.EMPTY
      return buffer
    }
    const { ctx, store, onStart } = setup({ takeTyped })
    store.addTimer()
    get(ctx, 'toggle').run()
    expect(store.selected).toMatchObject({
      timer: { phase: 'running', duration: 90 * SECOND, endsAt: NOW + 90 * SECOND },
    })
    expect(typed).toBe(digits.EMPTY)
    expect(onStart).toHaveBeenCalledWith('id1')
  })

  it('applies typed digits on a paused timer: it starts again with the new duration', () => {
    const { ctx, store } = setup({ takeTyped: () => '2' })
    store.addTimer()
    store.timer('id1', timer.start)
    store.timer('id1', timer.pause)
    get(ctx, 'toggle').run()
    expect(store.selected).toMatchObject({ timer: { phase: 'running', duration: 2 * SECOND } })
  })

  it('restarts a ringing timer and reports the start', () => {
    const { ctx, store, onStart, setNow } = setup()
    store.addTimer(SECOND)
    store.timer('id1', timer.start)
    store.settle(NOW + SECOND)
    onStart.mockClear()
    setNow(NOW + 5 * SECOND)
    get(ctx, 'restart').run()
    expect(store.selected).toMatchObject({ timer: { phase: 'running', endsAt: NOW + 6 * SECOND } })
    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('offers Pause, Lap and Reset on a running stopwatch, and runs them', () => {
    const { ctx, store, setNow } = setup()
    store.addStopwatch()
    expect(get(ctx, 'toggle').title).toBe('Start')
    expect(visible(ctx).has('lap')).toBe(false)
    get(ctx, 'toggle').run()
    expect(get(ctx, 'toggle').title).toBe('Pause')
    setNow(NOW + 1500)
    get(ctx, 'lap').run()
    expect(store.selected).toMatchObject({ stopwatch: { phase: 'running', laps: [1500] } })
    get(ctx, 'toggle').run()
    expect(get(ctx, 'toggle').title).toBe('Resume')
    expect(visible(ctx).has('lap')).toBe(false)
    get(ctx, 'reset').run()
    expect(store.selected).toMatchObject({ stopwatch: stopwatch.createStopwatch() })
  })

  it('toggles mute, with the title following the state', () => {
    const { ctx, store } = setup()
    store.addTimer()
    expect(get(ctx, 'mute').title).toBe('Mute')
    get(ctx, 'mute').run()
    expect(store.selected?.muted).toBe(true)
    expect(get(ctx, 'mute').title).toBe('Unmute')
    get(ctx, 'mute').run()
    expect(store.selected?.muted).toBe(false)
  })

  it('hands rename, fullscreen, undo, edit mode, help and settings to the app', () => {
    const { ctx, store, actions } = setup()
    store.addTimer()
    get(ctx, 'rename').run()
    expect(actions.startRename).toHaveBeenCalledWith('id1')
    get(ctx, 'fullscreen').run()
    expect(actions.toggleFullscreen).toHaveBeenCalledWith('id1')
    get(ctx, 'edit-mode').run()
    expect(actions.toggleEditMode).toHaveBeenCalledTimes(1)
    get(ctx, 'help').run()
    expect(actions.openHelp).toHaveBeenCalledTimes(1)
    expect(get(ctx, 'settings')).toMatchObject({ title: 'Settings…', shortcut: 'settings' })
    get(ctx, 'settings').run()
    expect(actions.openSettings).toHaveBeenCalledTimes(1)
    store.remove('id1')
    get(ctx, 'undo').run()
    expect(actions.undoRemove).toHaveBeenCalledTimes(1)
  })

  it('offers the mini window for the selected card only where the platform has one', () => {
    const without = setup()
    without.store.addTimer()
    expect(visible(without.ctx).has('mini-window')).toBe(false)

    const { ctx, store, actions } = setup({ miniWindow: true })
    store.addStopwatch()
    expect(get(ctx, 'mini-window')).toMatchObject({
      title: 'Open in mini window',
      hint: 'Stopwatch',
      shortcut: 'miniWindow',
      icon: 'picture_in_picture_alt',
    })
    get(ctx, 'mini-window').run()
    expect(actions.miniWindow).toHaveBeenCalledWith('id1')
  })

  it('deletes through the app, which may ask first, and the store keeps the card for undo', () => {
    const { ctx, store, actions } = setup()
    store.addTimer()
    get(ctx, 'delete').run()
    expect(actions.deleteCard).toHaveBeenCalledWith('id1')
    expect(store.cards).toEqual([])
    expect(store.lastRemoved?.card.id).toBe('id1')
  })

  it('offers Undo delete, naming the card, only after a delete', () => {
    const { ctx, store } = setup()
    store.addTimer()
    expect(visible(ctx).has('undo')).toBe(false)
    store.remove('id1')
    expect(get(ctx, 'undo')).toMatchObject({ title: 'Undo delete', hint: 'Timer' })
  })

  it('titles the edit-mode command after the mode', () => {
    expect(get(setup().ctx, 'edit-mode').title).toBe('Edit cards')
    expect(get(setup({ editing: true }).ctx, 'edit-mode').title).toBe('Done editing')
  })

  it('creates a timer from a preset, named and timed after it', () => {
    const { ctx, store } = setup()
    expect(get(ctx, 'preset-0')).toMatchObject({
      title: 'New timer: Tea',
      hint: '3:00',
      icon: 'hourglass_top',
    })
    get(ctx, 'preset-0').run()
    get(ctx, 'preset-0').run()
    expect(store.cards.map((c) => c.name)).toEqual(['Tea', 'Tea 2'])
    expect(store.selected).toMatchObject({ timer: { phase: 'idle', duration: 3 * MINUTE } })
  })

  it('creates idle default cards', () => {
    const { ctx, store } = setup()
    get(ctx, 'new-timer').run()
    get(ctx, 'new-stopwatch').run()
    expect(store.cards).toEqual([
      cards.createTimerCard('id1', 'Timer', NOW),
      cards.createStopwatchCard('id2', 'Stopwatch', NOW),
    ])
    expect(get(ctx, 'new-timer').hint).toBe('5:00')
  })

  it('writes durations in the fixed time style when it is set', () => {
    const { ctx } = setup({ timeStyle: 'fixed' })
    expect(get(ctx, 'new-timer').hint).toBe('00:05:00')
    expect(get(ctx, 'preset-0').hint).toBe('00:03:00')
    expect(digitCommand(ctx, '90')?.hint).toBe('00:01:30')
  })

  it('works without presets', () => {
    const { ctx } = setup({ presets: undefined })
    expect([...visible(ctx).keys()]).not.toContain('preset-0')
  })
})

describe('digitCommand', () => {
  it('offers "New timer HH:MM:SS" with the digits as typed', () => {
    const { ctx } = setup()
    expect(digitCommand(ctx, '13030')).toMatchObject({
      title: 'New timer 01:30:30',
      icon: 'hourglass_top',
    })
    expect(digitCommand(ctx, '13030')?.hint).toBeUndefined()
    expect(digitCommand(ctx, '5')?.title).toBe('New timer 00:00:05')
  })

  it('shows the normalized duration as the hint when the digits overflow', () => {
    const { ctx } = setup()
    expect(digitCommand(ctx, '90')).toMatchObject({ title: 'New timer 00:00:90', hint: '1:30' })
    expect(digitCommand(ctx, '7500')).toMatchObject({ hint: '1:15:00' })
  })

  it('creates and starts the timer, reporting the start', () => {
    const { ctx, store, onStart } = setup()
    store.addTimer()
    digitCommand(ctx, '90')?.run()
    expect(store.cards).toHaveLength(2)
    expect(store.selected).toMatchObject({
      id: 'id2',
      name: 'Timer 2',
      timer: { phase: 'running', duration: 90 * SECOND, endsAt: NOW + 90 * SECOND },
    })
    expect(onStart).toHaveBeenCalledWith('id2')
  })

  it('accepts surrounding spaces and leading zeros', () => {
    const { ctx } = setup()
    expect(digitCommand(ctx, ' 90 ')?.title).toBe('New timer 00:00:90')
    expect(digitCommand(ctx, '0090')?.title).toBe('New timer 00:00:90')
  })

  it('offers nothing for other queries, only zeros, or more than six digits', () => {
    const { ctx } = setup()
    for (const query of ['', ' ', 'stop', '1:30', '1 30', '-5', '0', '000000', '1234567', '١٢']) {
      expect(digitCommand(ctx, query), query).toBeNull()
    }
  })
})

describe('paletteResults', () => {
  it('lists every command that applies, in order, for an empty query', () => {
    const { ctx, store } = setup()
    store.addTimer()
    expect(paletteResults(ctx, '').map((c) => c.id)).toEqual(
      buildCommands(ctx)
        .filter((c) => c.when !== false)
        .map((c) => c.id),
    )
  })

  it('puts "New stopwatch" first for "stop"', () => {
    const { ctx, store } = setup()
    store.addStopwatch()
    store.stopwatch('id1', stopwatch.start)
    expect(paletteResults(ctx, 'stop')[0]?.id).toBe('new-stopwatch')
  })

  it('puts the digits command first for a digit query', () => {
    const { ctx } = setup()
    const results = paletteResults(ctx, '90')
    expect(results[0]?.id).toBe('new-typed-timer')
  })

  it('finds presets by name', () => {
    const { ctx } = setup()
    expect(paletteResults(ctx, 'pomo')[0]?.title).toBe('New timer: Pomodoro')
  })

  it('returns nothing when nothing matches', () => {
    const { ctx } = setup()
    expect(paletteResults(ctx, 'zzzz')).toEqual([])
  })

  it('hides commands that do not apply', () => {
    const { ctx, store } = setup()
    store.addTimer()
    expect(paletteResults(ctx, 'reset')).toEqual([])
    expect(paletteResults(ctx, 'undo')).toEqual([])
  })
})

describe('commands in other locales', () => {
  afterEach(() => {
    setAppLocale('en')
  })

  it('are titled in the active locale when the list is built', () => {
    const { ctx, store } = setup()
    store.addTimer()
    setAppLocale('ja')
    expect(get(ctx, 'toggle').title).toBe('開始')
    expect(get(ctx, 'preset-0').title).toBe('新しいタイマー：Tea')
    expect(get(ctx, 'edit-mode').title).toBe('カードを編集')
    expect(digitCommand(ctx, '90')?.title).toBe('新しいタイマー 00:00:90')
    setAppLocale('zh-TW')
    expect(get(ctx, 'mute').title).toBe('靜音')
    expect(get(ctx, 'help').title).toBe('鍵盤快速鍵')
  })

  it('are found by their localized titles', () => {
    const { ctx } = setup()
    setAppLocale('zh-TW')
    expect(paletteResults(ctx, '碼錶')[0]?.id).toBe('new-stopwatch')
    setAppLocale('ja')
    expect(paletteResults(ctx, 'ショートカット')[0]?.id).toBe('help')
  })
})
