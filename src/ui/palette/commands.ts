/**
 * The command palette's commands (spec.md › Command palette): new cards and presets, actions on
 * the selected card, edit mode and help, each with the keyboard shortcut that does the same.
 * Typing 1–6 digits adds "New timer HH:MM:SS" at the top, which creates and starts that timer.
 *
 * Commands are rebuilt from the current state whenever the palette shows them, so titles follow
 * the selected card ("Pause" while it runs). `run` acts on the store's state at that moment.
 */
import {
  cards,
  digits,
  formatCountdown,
  stopwatch,
  timer,
  type DigitBuffer,
  type keymap,
  type StopwatchPhase,
  type TimerPhase,
} from '../../core'
import type { CardStore } from '../../state/cards.svelte'
import type { AppActions } from '../../state/keyboard.svelte'
import { runTimer, toggleTimer } from '../../state/timer-actions'
import type { Preset } from '../../state/presets'
import type { IconName } from '../primitives/icons'
import { rank } from './fuzzy'

/** What commands act on. */
export interface CommandContext {
  readonly cardStore: CardStore
  readonly actions: AppActions
  /** Timer presets, listed as "New timer: <name>". */
  readonly presets?: readonly Preset[] | undefined
  /** Whether edit mode is on, for the edit-mode command's title. */
  readonly editing?: boolean | undefined
  /** Called after a command starts, resumes or restarts timer `id` (see `KeyboardDeps.onStart`). */
  readonly onStart?: ((id: cards.CardId) => void) | undefined
  /**
   * Hands over the digits typed for the selected timer and clears them. Start/Pause applies them
   * first, as Space does (spec › Shortcuts); without it nothing counts as typed.
   */
  readonly takeTyped?: (() => DigitBuffer) | undefined
}

export interface Command {
  /** Stable within one list. */
  readonly id: string
  readonly title: string
  /** Secondary text: the card a command acts on, or a preset's duration. */
  readonly hint?: string
  /** The action whose shortcut does the same thing. */
  readonly shortcut?: keymap.ActionId
  readonly icon?: IconName
  /** False when the command does not apply now; the palette hides it. */
  readonly when?: boolean
  readonly run: () => void
}

const TIMER_TOGGLE: Readonly<Record<TimerPhase, { title: string; icon: IconName }>> = {
  idle: { title: 'Start', icon: 'play_arrow' },
  running: { title: 'Pause', icon: 'pause' },
  paused: { title: 'Resume', icon: 'play_arrow' },
  ringing: { title: 'Dismiss', icon: 'done' },
}

const STOPWATCH_TOGGLE: Readonly<Record<StopwatchPhase, { title: string; icon: IconName }>> = {
  idle: { title: 'Start', icon: 'play_arrow' },
  running: { title: 'Pause', icon: 'pause' },
  paused: { title: 'Resume', icon: 'play_arrow' },
}

/** The query that offers a new timer: one to six ASCII digits. */
const DIGITS_QUERY = /^[0-9]{1,6}$/

/** Commands for the selected card; the card's name is the hint. */
function cardCommands(ctx: CommandContext, card: cards.Card): Command[] {
  const { cardStore: store, actions } = ctx
  const { id, name: hint } = card
  const out: Command[] = []
  if (card.kind === 'timer') {
    const t = card.timer
    out.push(
      {
        id: 'toggle',
        ...TIMER_TOGGLE[t.phase],
        hint,
        shortcut: 'toggle',
        when: t.phase !== 'idle' || t.duration > 0,
        run: () => {
          toggleTimer(store, id, ctx.takeTyped?.() ?? digits.EMPTY, ctx.onStart)
        },
      },
      {
        id: 'restart',
        title: 'Restart',
        hint,
        icon: 'restart_alt',
        when: t.phase === 'ringing',
        run: () => {
          runTimer(store, id, timer.restart, ctx.onStart)
        },
      },
      {
        id: 'reset',
        title: 'Reset',
        hint,
        shortcut: 'reset',
        icon: 'restart_alt',
        when: t.phase !== 'idle',
        run: () => {
          store.timer(id, timer.reset)
        },
      },
    )
  } else {
    const s = card.stopwatch
    out.push(
      {
        id: 'toggle',
        ...STOPWATCH_TOGGLE[s.phase],
        hint,
        shortcut: 'toggle',
        run: () => {
          store.stopwatch(id, stopwatch.toggle)
        },
      },
      {
        id: 'lap',
        title: 'Lap',
        hint,
        shortcut: 'lap',
        icon: 'flag',
        when: s.phase === 'running',
        run: () => {
          store.stopwatch(id, stopwatch.lap)
        },
      },
      {
        id: 'reset',
        title: 'Reset',
        hint,
        shortcut: 'reset',
        icon: 'restart_alt',
        when: s.phase !== 'idle',
        run: () => {
          store.stopwatch(id, stopwatch.reset)
        },
      },
    )
  }
  out.push(
    {
      id: 'mute',
      title: card.muted ? 'Unmute' : 'Mute',
      hint,
      shortcut: 'mute',
      icon: card.muted ? 'volume_up' : 'volume_off',
      run: () => {
        store.setMuted(id, !card.muted)
      },
    },
    {
      id: 'rename',
      title: 'Rename',
      hint,
      shortcut: 'rename',
      icon: 'edit',
      run: () => {
        actions.startRename(id)
      },
    },
    {
      id: 'fullscreen',
      title: 'Fullscreen',
      hint,
      shortcut: 'fullscreen',
      icon: 'fullscreen',
      run: () => {
        actions.toggleFullscreen(id)
      },
    },
    {
      id: 'delete',
      title: 'Delete',
      hint,
      shortcut: 'deleteCard',
      icon: 'delete',
      run: () => {
        store.remove(id)
      },
    },
  )
  return out
}

/**
 * Every command, in palette order: actions on the selected card, undo, new cards, presets, edit
 * mode and help. Commands that do not apply now have `when: false`.
 */
export function buildCommands(ctx: CommandContext): readonly Command[] {
  const { cardStore: store, actions } = ctx
  const card = store.selected
  const removed = store.lastRemoved
  const commands: Command[] = card === undefined ? [] : cardCommands(ctx, card)
  commands.push(
    {
      id: 'undo',
      title: 'Undo delete',
      ...(removed === null ? {} : { hint: removed.card.name }),
      shortcut: 'undo',
      icon: 'undo',
      when: removed !== null,
      run: () => {
        actions.undoRemove()
      },
    },
    {
      id: 'new-timer',
      title: 'New timer',
      hint: formatCountdown(cards.DEFAULT_TIMER_DURATION),
      shortcut: 'newTimer',
      icon: 'add',
      run: () => {
        store.addTimer()
      },
    },
    {
      id: 'new-stopwatch',
      title: 'New stopwatch',
      shortcut: 'newStopwatch',
      icon: 'add',
      run: () => {
        store.addStopwatch()
      },
    },
  )
  ;(ctx.presets ?? []).forEach((preset, index) => {
    commands.push({
      id: `preset-${String(index)}`,
      title: `New timer: ${preset.name}`,
      hint: formatCountdown(preset.duration),
      icon: 'hourglass_top',
      run: () => {
        store.addTimer(preset.duration, preset.name)
      },
    })
  })
  commands.push(
    {
      id: 'edit-mode',
      title: ctx.editing === true ? 'Done editing' : 'Edit cards',
      shortcut: 'editMode',
      icon: ctx.editing === true ? 'done' : 'edit',
      run: () => {
        actions.toggleEditMode()
      },
    },
    {
      id: 'help',
      title: 'Keyboard shortcuts',
      shortcut: 'help',
      icon: 'keyboard',
      run: () => {
        actions.openHelp()
      },
    },
  )
  return commands
}

/**
 * The "New timer HH:MM:SS" command for a query of 1–6 digits (surrounding spaces allowed), or
 * `null` for any other query and for one of only zeros. The title shows the digits as typed
 * (`90` → `00:00:90`); when they overflow, the hint shows the normalized duration (`1:30`).
 * Running it adds the timer and starts it.
 */
export function digitCommand(ctx: CommandContext, query: string): Command | null {
  const text = typeof query === 'string' ? query.trim() : ''
  if (!DIGITS_QUERY.test(text)) return null
  let buffer = digits.EMPTY
  for (const ch of text) buffer = digits.pushDigit(buffer, ch)
  if (digits.isEmpty(buffer)) return null
  const duration = digits.toDurationMs(buffer)
  const { minutes, seconds } = digits.toFields(buffer)
  const overflow = minutes >= 60 || seconds >= 60
  return {
    id: 'new-typed-timer',
    title: `New timer ${digits.formatTyped(buffer)}`,
    ...(overflow ? { hint: formatCountdown(duration) } : {}),
    icon: 'hourglass_top',
    run: () => {
      const id = ctx.cardStore.addTimer(duration)
      runTimer(ctx.cardStore, id, timer.start, ctx.onStart)
    },
  }
}

/**
 * What the palette lists for `query`: the digits command first when the query is digits, then
 * the commands that apply now whose title matches, tightest match first and in command order on
 * ties (`fuzzy.rank`). An empty query lists every command that applies.
 */
export function paletteResults(ctx: CommandContext, query: string): readonly Command[] {
  const visible = buildCommands(ctx).filter((command) => command.when !== false)
  const ranked = rank(visible, query, (command) => command.title)
  const typed = digitCommand(ctx, query)
  return typed === null ? ranked : [typed, ...ranked]
}
