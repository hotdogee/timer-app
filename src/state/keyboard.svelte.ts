/**
 * The keyboard controller: turns key presses into card actions (spec.md › Keyboard). Digits and
 * Backspace edit the selected timer's typed duration; every other key goes through the rebindable
 * keymap (`core/keymap.ts`) to an action, which runs on the card store or, for UI-only actions
 * (dialogs, settings, edit mode, rename, fullscreen) and deleting (which may ask first), on the
 * app through {@link AppActions}.
 *
 * Keys are ignored while focus is in a text field, while a dialog is open (the dialog owns the
 * keyboard, Esc included; a dialog that has just closed no longer counts), during IME composition, and when another handler already called
 * `preventDefault`. A focused button keeps Space and Enter, and a focused slider keeps the arrows.
 * Modifiers must match a binding exactly, so Ctrl+R still reloads the page. Held keys repeat only
 * digits, Backspace and the arrow actions.
 *
 * Typed digits belong to the selected timer while it is not running. When the selection or the
 * selected card's phase changes some other way (a click, a button, the alarm), the digits are
 * dropped, so they never apply to a different card or a running timer.
 *
 * The controller also remembers the last-used card, the one most recently started, resumed or
 * paused by any means (a key, a button, the palette, the mini window, another tab), for the desktop
 * app's global hotkey and tray command "Start or pause the last card" ({@link
 * KeyboardController.toggleLast}).
 */
import { untrack } from 'svelte'

import {
  cards,
  digits,
  keymap,
  stopwatch,
  timer,
  type DigitBuffer,
  type StopwatchPhase,
  type TimerPhase,
} from '../core'
import type { CardStore } from './cards.svelte'
import { startTimer, toggleTimer } from './timer-actions'

/** What the controller asks of the app: actions that need UI state it does not have. */
export interface AppActions {
  /** Opens the command palette. */
  openPalette(): void
  /** Opens the keyboard shortcut cheat sheet. */
  openHelp(): void
  /** Opens the settings dialog. */
  openSettings(): void
  /** Turns edit mode on or off. */
  toggleEditMode(): void
  /** Starts renaming card `id` (its name becomes a text field). */
  startRename(id: cards.CardId): void
  /** Shows card `id` fullscreen, or leaves fullscreen. */
  toggleFullscreen(id: cards.CardId): void
  /** Opens card `id` in the always-on-top mini window (where the platform has one). */
  miniWindow(id: cards.CardId): void
  /** Opens the timer presets (the action bar's "+ Timer" menu). */
  openPresets(): void
  /**
   * Deletes card `id`, or first asks whether to when the confirm-delete setting is on. The delete
   * itself goes through the card store, which keeps the card for undo.
   */
  deleteCard(id: cards.CardId): void
  /** Undoes the last delete, while its snackbar is visible. */
  undoRemove(): void
  /** Esc with nothing typed: closes what is open or leaves edit mode. */
  cancel(): void
}

/** What {@link createKeyboardController} works with. */
export interface KeyboardDeps {
  readonly cardStore: CardStore
  /** The modifier convention: `'mac'` reads `Mod` as Cmd. See {@link detectKeyPlatform}. */
  readonly platform: keymap.Platform
  /**
   * The shortcuts. Read on every key press, so a getter here supplies live settings (the app
   * passes `get bindings() { return settingsStore.bindings }`).
   */
  readonly bindings: keymap.Bindings
  /** The number of grid columns now, for the up and down arrows. */
  readonly getColumns: () => number
  /** The digits typed for the selected timer. */
  readonly getTyped: () => DigitBuffer
  readonly setTyped: (buffer: DigitBuffer) => void
  readonly actions: AppActions
  /**
   * Called inside the key event right after a key starts, resumes or restarts timer `id`, so the
   * app can unlock audio and ask for notification permission while the user gesture is active.
   */
  readonly onStart?: ((id: cards.CardId) => void) | undefined
  /** Whether a dialog is open. Defaults to looking for an open `<dialog>` in the document. */
  readonly isDialogOpen?: (() => boolean) | undefined
}

/** The parts of a `KeyboardEvent` the controller reads; a real `KeyboardEvent` fits. */
export interface KeyboardEventLike extends keymap.KeyEventLike {
  readonly repeat: boolean
  readonly isComposing?: boolean
  readonly defaultPrevented: boolean
  /** The focused element (or the body); only its tag, type, role and ancestors are read. */
  readonly target: unknown
  preventDefault(): void
  getModifierState?(key: string): boolean
}

export interface KeyboardController {
  /** The window `keydown` handler: `<svelte:window onkeydown={keyboard.handleKeydown} />`. */
  readonly handleKeydown: (event: KeyboardEventLike) => void
  /**
   * Starts or pauses the last-used card (the one most recently started, resumed or paused, else
   * the selected one) as Space would, but without typed digits: it starts an idle card, pauses a
   * running one, resumes a paused one and dismisses a ringing timer. For the desktop app's global
   * hotkey and tray command, which act without focusing the window (spec › Keyboard).
   */
  readonly toggleLast: () => void
  /** Stops watching the selection. Call it when the app unmounts. */
  readonly destroy: () => void
}

/** The actions a held key repeats: moving the selection and moving a card. */
const REPEATABLE: ReadonlySet<keymap.ActionId> = new Set<keymap.ActionId>([
  'selectLeft',
  'selectRight',
  'selectUp',
  'selectDown',
  'moveLeft',
  'moveRight',
  'moveUp',
  'moveDown',
])

const DIRECTIONS = {
  selectLeft: 'left',
  selectRight: 'right',
  selectUp: 'up',
  selectDown: 'down',
  moveLeft: 'left',
  moveRight: 'right',
  moveUp: 'up',
  moveDown: 'down',
} as const satisfies Partial<Record<keymap.ActionId, cards.Direction>>

/** Keys an input method sends while composing text, which never are shortcuts. */
const IME_KEYS: ReadonlySet<string> = new Set(['Process', 'Unidentified', 'Dead'])

const ARROW_KEYS: ReadonlySet<string> = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** `<input>` types that are not text fields. Every other type (and no type) takes typing. */
const NON_TEXT_INPUTS: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
])

/** ARIA roles of text fields. */
const TEXT_ROLES: ReadonlySet<string> = new Set(['textbox', 'searchbox', 'combobox'])

/** ARIA roles of controls that act on Space and Enter themselves. */
const ACTIVATABLE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'switch',
])

/** ARIA roles of controls that use the arrow keys themselves. */
const ARROW_ROLES: ReadonlySet<string> = new Set([
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'scrollbar',
  'slider',
  'spinbutton',
])

/** How far up the tree {@link insideDialog} looks. */
const MAX_DEPTH = 64

/** The element-like parts of an event target the controller reads. */
interface ElementLike {
  readonly tagName?: unknown
  readonly type?: unknown
  readonly isContentEditable?: unknown
  readonly parentElement?: unknown
  readonly getAttribute?: unknown
}

function asElement(target: unknown): ElementLike | null {
  return typeof target === 'object' && target !== null && 'tagName' in target ? target : null
}

function tagOf(el: ElementLike): string {
  return typeof el.tagName === 'string' ? el.tagName.toUpperCase() : ''
}

function attribute(el: ElementLike, name: string): string | null {
  if (typeof el.getAttribute !== 'function') return null
  const value: unknown = (el.getAttribute as (name: string) => unknown).call(el, name)
  return typeof value === 'string' ? value : null
}

function inputType(el: ElementLike): string {
  return typeof el.type === 'string' && el.type !== '' ? el.type.toLowerCase() : 'text'
}

/** Whether `target` takes typed text: text inputs, text areas, selects and editable content. */
export function isTextEntry(target: unknown): boolean {
  const el = asElement(target)
  if (el === null) return false
  if (el.isContentEditable === true) return true
  const tag = tagOf(el)
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUTS.has(inputType(el))
  return TEXT_ROLES.has(attribute(el, 'role') ?? '')
}

/** Whether `target` is a control that acts on Space and Enter itself, such as a button. */
export function isActivatable(target: unknown): boolean {
  const el = asElement(target)
  if (el === null) return false
  const tag = tagOf(el)
  if (tag === 'BUTTON' || tag === 'SUMMARY' || tag === 'INPUT') return true
  if (tag === 'A') return attribute(el, 'href') !== null
  return ACTIVATABLE_ROLES.has(attribute(el, 'role') ?? '')
}

/** Whether `target` uses the arrow keys itself, such as a slider or a radio button. */
export function ownsArrows(target: unknown): boolean {
  const el = asElement(target)
  if (el === null) return false
  if (tagOf(el) === 'INPUT' && ['range', 'radio'].includes(inputType(el))) return true
  return ARROW_ROLES.has(attribute(el, 'role') ?? '')
}

/**
 * Whether `target` is an open `<dialog>` or inside one. A closed dialog does not count: right
 * after a dialog opened from the page closes, focus can still be on a control inside it for a
 * frame, and the next key press belongs to the page.
 */
export function insideDialog(target: unknown): boolean {
  let el = asElement(target)
  for (let depth = 0; el !== null && depth < MAX_DEPTH; depth++) {
    if (tagOf(el) === 'DIALOG') return attribute(el, 'open') !== null
    el = asElement(el.parentElement)
  }
  return false
}

/** Whether the document has an open `<dialog>`. False where there is no document (tests). */
function documentHasOpenDialog(): boolean {
  return typeof document !== 'undefined' && document.querySelector('dialog[open]') !== null
}

/** The part of `navigator` that {@link detectKeyPlatform} reads. */
export interface NavigatorLike {
  readonly platform?: string
  readonly userAgent?: string
  readonly userAgentData?: { readonly platform?: string } | undefined
}

/**
 * The modifier convention of this device: `'mac'` on macOS, iOS and iPadOS (which reports
 * `MacIntel`), `'other'` elsewhere and when unknown.
 */
export function detectKeyPlatform(
  nav: NavigatorLike | undefined = globalThis.navigator,
): keymap.Platform {
  // The first non-empty hint: User-Agent Client Hints, then the legacy fields.
  const name = [nav?.userAgentData?.platform, nav?.platform, nav?.userAgent].find(
    (hint) => typeof hint === 'string' && hint !== '',
  )
  return name !== undefined && /mac|iphone|ipad|ipod/i.test(name) ? 'mac' : 'other'
}

/** The selected card's identity and phase, to notice changes made outside the controller. */
interface Snapshot {
  readonly id: cards.CardId | null
  readonly phase: TimerPhase | StopwatchPhase | null
}

function snapshotOf(card: cards.Card | undefined): Snapshot {
  if (card === undefined) return { id: null, phase: null }
  return { id: card.id, phase: phaseOf(card) }
}

function phaseOf(card: cards.Card): TimerPhase | StopwatchPhase {
  return card.kind === 'timer' ? card.timer.phase : card.stopwatch.phase
}

/**
 * The card that `after` started, resumed or paused compared with `before`: one whose phase became
 * running or paused (the last such in grid order when several did, as an import or a sync may
 * do), or null when none did. A card that arrives already running counts as started.
 */
export function lastToggledCard(
  before: cards.CardList,
  after: cards.CardList,
): cards.CardId | null {
  if (before === after) return null
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- a local, never read reactively
  const old = new Map(before.cards.map((card) => [card.id, card]))
  let found: cards.CardId | null = null
  for (const card of after.cards) {
    const phase = phaseOf(card)
    if (phase !== 'running' && phase !== 'paused') continue
    const previous = old.get(card.id)
    if (previous === card) continue
    if (previous === undefined || phaseOf(previous) !== phase) found = card.id
  }
  return found
}

/** Whether digits typed now would edit `card`: a timer that is not running. */
function takesDigits(card: cards.Card | undefined): card is cards.TimerCard {
  return card?.kind === 'timer' && card.timer.phase !== 'running'
}

/**
 * Creates the keyboard controller. Call it once (it watches the selection in an effect root) and
 * {@link KeyboardController.destroy} it when the app goes away.
 */
export function createKeyboardController(deps: KeyboardDeps): KeyboardController {
  const store = deps.cardStore
  const dialogOpen = deps.isDialogOpen ?? documentHasOpenDialog
  const selected = (): cards.Card | undefined => untrack(() => store.selected)

  /** The selected card as this controller last left it. */
  let seen = snapshotOf(selected())

  function remember(): void {
    seen = snapshotOf(selected())
  }

  function clearTyped(): void {
    if (!digits.isEmpty(deps.getTyped())) deps.setTyped(digits.EMPTY)
  }

  /** Returns the typed digits and clears them. */
  function takeTyped(): DigitBuffer {
    const typed = deps.getTyped()
    clearTyped()
    return typed
  }

  /**
   * Drops typed digits that no longer belong to the selection: the selected card or its phase
   * changed since the controller last acted, or the selected card does not take digits.
   */
  function reconcile(): void {
    const card = selected()
    const now = snapshotOf(card)
    const changed = now.id !== seen.id || now.phase !== seen.phase
    seen = now
    if (changed || !takesDigits(card)) clearTyped()
  }

  /** Digits and Backspace: edit the selected timer's typed duration. Returns whether it applied. */
  function typeDigit(key: string): boolean {
    const card = selected()
    if (!takesDigits(card)) return false
    const typed = deps.getTyped()
    if (key === 'Backspace') {
      const next = digits.popDigit(typed)
      if (next === typed) return false
      deps.setTyped(next)
      return true
    }
    // Typing on a ringing timer dismisses it and starts a new duration (spec › Digit entry).
    if (card.timer.phase === 'ringing') store.timer(card.id, timer.dismiss)
    const next = digits.pushDigit(typed, key)
    if (next !== typed) deps.setTyped(next)
    remember()
    return true
  }

  /** Space: start or pause, after applying typed digits; dismisses a ringing timer. */
  function toggle(card: cards.Card): void {
    if (card.kind === 'stopwatch') {
      store.stopwatch(card.id, stopwatch.toggle)
      return
    }
    toggleTimer(store, card.id, takeTyped(), deps.onStart)
  }

  /** Enter: with digits, sets the duration and starts; without, starts, or dismisses a ringing timer. */
  function start(card: cards.Card): void {
    if (card.kind === 'stopwatch') {
      store.stopwatch(card.id, stopwatch.start)
      return
    }
    startTimer(store, card.id, takeTyped(), deps.onStart)
  }

  /** R: back to idle; typed digits are discarded, not applied. */
  function reset(card: cards.Card): void {
    clearTyped()
    if (card.kind === 'timer') store.timer(card.id, timer.reset)
    else store.stopwatch(card.id, stopwatch.reset)
  }

  function run(action: keymap.ActionId): void {
    const card = selected()
    switch (action) {
      case 'toggle':
        if (card !== undefined) toggle(card)
        break
      case 'start':
        if (card !== undefined) start(card)
        break
      case 'dismiss':
        if (card?.kind === 'timer') store.timer(card.id, timer.dismiss)
        break
      case 'reset':
        if (card !== undefined) reset(card)
        break
      case 'lap':
        if (card?.kind === 'stopwatch') store.stopwatch(card.id, stopwatch.lap)
        break
      case 'newTimer':
        store.addTimer()
        break
      case 'newStopwatch':
        store.addStopwatch()
        break
      case 'deleteCard':
        if (card !== undefined) deps.actions.deleteCard(card.id)
        break
      case 'undo':
        deps.actions.undoRemove()
        break
      case 'rename':
        if (card !== undefined) deps.actions.startRename(card.id)
        break
      case 'editMode':
        deps.actions.toggleEditMode()
        break
      case 'fullscreen':
        if (card !== undefined) deps.actions.toggleFullscreen(card.id)
        break
      case 'mute':
        if (card !== undefined) store.setMuted(card.id, !card.muted)
        break
      case 'miniWindow':
        if (card !== undefined) deps.actions.miniWindow(card.id)
        break
      case 'presets':
        deps.actions.openPresets()
        break
      case 'palette':
        deps.actions.openPalette()
        break
      case 'help':
        deps.actions.openHelp()
        break
      case 'settings':
        deps.actions.openSettings()
        break
      case 'selectLeft':
      case 'selectRight':
      case 'selectUp':
      case 'selectDown':
        store.selectNeighbor(DIRECTIONS[action], deps.getColumns())
        break
      case 'moveLeft':
      case 'moveRight':
      case 'moveUp':
      case 'moveDown':
        if (card !== undefined) store.moveNeighbor(card.id, DIRECTIONS[action], deps.getColumns())
        break
      case 'cancel':
        if (digits.isEmpty(deps.getTyped())) deps.actions.cancel()
        else clearTyped()
        break
    }
  }

  const handleKeydown = (event: KeyboardEventLike): void => {
    if (event.defaultPrevented || event.isComposing === true || IME_KEYS.has(event.key)) return
    if (dialogOpen() || insideDialog(event.target) || isTextEntry(event.target)) return
    reconcile()

    const { key, ctrlKey, altKey, metaKey } = event
    if ((keymap.isDigitKey(key) || key === 'Backspace') && !ctrlKey && !altKey && !metaKey) {
      if (typeDigit(key)) event.preventDefault()
      return
    }
    const pressed = keymap.comboFromEvent(event).key
    // A focused button acts on Space and Enter itself; acting here too would act twice.
    if ((pressed === ' ' || pressed === 'Enter') && isActivatable(event.target)) return
    if (ARROW_KEYS.has(pressed) && ownsArrows(event.target)) return

    // AltGr (reported as Ctrl+Alt) is not a modifier: the character it types is the key.
    const action = keymap.resolveAction(
      deps.bindings,
      keymap.keyEventForMatching(event),
      deps.platform,
    )
    if (action === null) return
    // The key is ours even when held, so a held Space does not scroll the page.
    event.preventDefault()
    if (event.repeat && !REPEATABLE.has(action)) return
    run(action)
    // An action that changed the selection or the selected card's phase drops typed digits.
    reconcile()
  }

  /** The card most recently started, resumed or paused since the controller was created. */
  let lastUsed: cards.CardId | null = null
  let watchedList = untrack(() => store.list)

  /** See {@link KeyboardController.toggleLast}. */
  function toggleLast(): void {
    const list = untrack(() => store.list)
    const card =
      (lastUsed === null ? undefined : cards.findCard(list, lastUsed)) ??
      (list.selectedId === null ? undefined : cards.findCard(list, list.selectedId))
    if (card === undefined) return
    lastUsed = card.id
    if (card.kind === 'stopwatch') store.stopwatch(card.id, stopwatch.toggle)
    else toggleTimer(store, card.id, digits.EMPTY, deps.onStart)
  }

  // Selection and phase changes made elsewhere (clicks, buttons, the alarm) drop typed digits
  // right away, so a card never shows digits that would not apply to it.
  const stopWatching = $effect.root(() => {
    $effect(() => {
      void store.selected
      untrack(reconcile)
    })
    // Every start, resume and pause, wherever it came from, makes that card the last used.
    $effect(() => {
      const list = store.list
      untrack(() => {
        lastUsed = lastToggledCard(watchedList, list) ?? lastUsed
        watchedList = list
      })
    })
  })

  let destroyed = false
  return {
    handleKeydown,
    toggleLast,
    destroy: () => {
      if (destroyed) return
      destroyed = true
      stopWatching()
    },
  }
}
