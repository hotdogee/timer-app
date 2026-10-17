/**
 * Keyboard rebinding for Settings › Keyboard (spec › Shortcuts): which actions the list shows and
 * how they are grouped, the key combos of each action as stored text and display labels, what a
 * recorded key press means (refused, taken by another action, or free), and the keymap overrides
 * after a change. Pure; the overrides are `SyncedSettings['keymap']`.
 *
 * Recorded combos are stored portably: the platform's command modifier (Cmd on macOS, Ctrl
 * elsewhere) is written as `Mod`, so a shortcut recorded on a Mac as ⌘K works as Ctrl+K on
 * Windows once settings sync. Overrides are kept minimal: an action whose combos end up the same
 * as its defaults has no override.
 */
import { keymap, settings } from '../../core'
import { m } from '../../i18n'

type ActionId = keymap.ActionId
type KeyCombo = keymap.KeyCombo
type Platform = keymap.Platform

/** A titled group of actions in the rebinding list. */
export interface ShortcutGroup {
  /** The group title, as a message read when the list is shown. */
  readonly title: () => string
  readonly actions: readonly ActionId[]
}

/**
 * The rebinding list's groups, in the cheat sheet's order. Every action appears once, except
 * {@link HIDDEN_ACTIONS}.
 */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = Object.freeze([
  {
    title: m.shortcut_group_running,
    actions: ['toggle', 'start', 'dismiss', 'reset', 'lap'],
  },
  {
    title: m.help_section_cards,
    actions: [
      'newTimer',
      'newStopwatch',
      'presets',
      'rename',
      'mute',
      'fullscreen',
      'deleteCard',
      'undo',
    ],
  },
  {
    title: m.help_section_navigation,
    actions: [
      'selectLeft',
      'selectRight',
      'selectUp',
      'selectDown',
      'moveLeft',
      'moveRight',
      'moveUp',
      'moveDown',
    ],
  },
  { title: m.help_section_app, actions: ['palette', 'help', 'settings', 'editMode', 'cancel'] },
])

/** Actions left out of the list: the mini window stays hidden until it ships (M5). */
export const HIDDEN_ACTIONS: readonly ActionId[] = Object.freeze(['miniWindow'])

/** One combo bound to an action, as stored and as shown. */
export interface BoundKey {
  /** The binding text, as the bindings hold it. */
  readonly text: string
  /** The display label on this platform (`Ctrl+K`, `⌘K`). */
  readonly label: string
}

/** Whether `a` and `b` match the same key presses (`?` and `Shift+?` do; `N` and `Shift+N` not). */
export function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
  return keymap.matches(a, {
    key: b.key,
    ctrlKey: b.ctrl,
    altKey: b.alt,
    shiftKey: b.shift,
    metaKey: b.meta,
  })
}

/** The key part of binding text: `Space` for the space bar, the key value otherwise. */
function keyText(key: string): string {
  return key === ' ' ? 'Space' : key
}

/**
 * Binding text for `combo` as recorded on `platform`, with the platform's command modifier written
 * as `Mod` (Cmd on macOS, Ctrl elsewhere): ⌘⇧K on a Mac gives `'Mod+Shift+k'`, Ctrl+, elsewhere
 * gives `'Mod+,'`. `keymap.parseCombo(text, platform)` reads it back to the same combo.
 */
export function comboText(combo: KeyCombo, platform: Platform): string {
  const mod = platform === 'mac' ? combo.meta : combo.ctrl
  const parts: string[] = []
  if (mod) parts.push('Mod')
  if (platform === 'mac' && combo.ctrl) parts.push('Ctrl')
  if (combo.alt) parts.push('Alt')
  if (combo.shift) parts.push('Shift')
  if (platform !== 'mac' && combo.meta) parts.push('Meta')
  parts.push(keyText(combo.key))
  return parts.join('+')
}

/**
 * The keys bound to `action` on `platform`, in binding order, without text that does not parse
 * and without repeats of a combo already listed.
 */
export function boundKeys(
  bindings: keymap.Bindings,
  action: ActionId,
  platform: Platform,
): readonly BoundKey[] {
  const kept: keymap.ParsedBinding[] = []
  for (const key of keymap.parsedCombos(bindings, action, platform)) {
    if (!kept.some((other) => sameCombo(other.combo, key.combo))) kept.push(key)
  }
  return kept.map(({ text, combo }) => ({ text, label: keymap.formatCombo(combo, platform) }))
}

/** Whether two lists of binding text bind the same combos, in the same order, on `platform`. */
function sameKeys(a: readonly string[], b: readonly string[], platform: Platform): boolean {
  if (a.length !== b.length) return false
  return a.every((text, i) => {
    const other = b[i] ?? ''
    if (text === other) return true
    const x = keymap.parseCombo(text, platform)
    const y = keymap.parseCombo(other, platform)
    return x !== null && y !== null && sameCombo(x, y)
  })
}

/** Whether the user changed `action`'s shortcut from its default. */
export function isCustomized(
  overrides: settings.KeymapOverrides,
  action: ActionId,
  platform: Platform,
): boolean {
  const list = Object.hasOwn(overrides, action) ? overrides[action] : undefined
  return list !== undefined && !sameKeys(list, keymap.DEFAULT_BINDINGS[action], platform)
}

/** Whether any action's shortcut differs from its default. */
export function hasCustomizations(
  overrides: settings.KeymapOverrides,
  platform: Platform,
): boolean {
  return keymap.ACTION_IDS.some((action) => isCustomized(overrides, action, platform))
}

/** What a key press in the recorder means for the action being changed. */
export type Recording =
  /** The key cannot be a shortcut (digits, Backspace, a bare modifier, an unknown key). */
  | { readonly kind: 'reserved'; readonly label: string }
  /**
   * Other actions in the list use the key already; `owners` are those, in `keymap.ACTION_IDS`
   * order. Moving the key here takes it from every action in `moveFrom` (the owners and any
   * {@link HIDDEN_ACTIONS} that use it too).
   */
  | {
      readonly kind: 'conflict'
      readonly label: string
      readonly text: string
      readonly owners: readonly ActionId[]
      readonly moveFrom: readonly ActionId[]
    }
  /**
   * The key is free (or already this action's), so it can be set. A hidden action that uses it
   * is listed in `moveFrom`: it is not in the list, so it silently gives the key up.
   */
  | {
      readonly kind: 'free'
      readonly label: string
      readonly text: string
      readonly moveFrom: readonly ActionId[]
    }

/** The longest binding text the settings keep (as `settings.migrateSyncedSettings` does). */
const MAX_TEXT_LENGTH = 64

/**
 * Classifies `pressed`, recorded for `action`: `reserved` when it cannot be bound
 * (`keymap.isReservedCombo`, or a key the keymap cannot store), `conflict` when other listed
 * actions already use it, `free` otherwise. A character whose Shift depends on the layout (`?`,
 * `+`) is taken without Shift, as matching ignores it there, so Shift+/ records as `?`. The label
 * is the combo's display text on `platform`.
 */
export function classifyRecording(
  bindings: keymap.Bindings,
  action: ActionId,
  pressed: KeyCombo,
  platform: Platform,
): Recording {
  const combo = keymap.isShiftInsensitive(pressed.key) ? { ...pressed, shift: false } : pressed
  const label = keymap.formatCombo(combo, platform)
  const text = comboText(combo, platform)
  const back = keymap.parseCombo(text, platform)
  if (
    keymap.isReservedCombo(combo) ||
    back === null ||
    !sameCombo(back, combo) ||
    text.length > MAX_TEXT_LENGTH
  ) {
    return { kind: 'reserved', label }
  }
  const moveFrom = keymap.ACTION_IDS.filter(
    (other) =>
      other !== action &&
      keymap.parsedCombos(bindings, other, platform).some((key) => sameCombo(key.combo, combo)),
  )
  const owners = moveFrom.filter((other) => !HIDDEN_ACTIONS.includes(other))
  return owners.length > 0
    ? { kind: 'conflict', label, text, owners, moveFrom }
    : { kind: 'free', label, text, moveFrom }
}

/** A combo of an action that other listed actions use too. */
export interface SharedShortcut {
  /** The combo's display text on the platform. */
  readonly label: string
  /** The other actions bound to it, in `keymap.ACTION_IDS` order. */
  readonly others: readonly ActionId[]
}

/**
 * The combos bound to more than one listed action ({@link HIDDEN_ACTIONS} left out), by action:
 * for each action that shares a combo, the shared combos and the other actions using each. Such overlaps come from an import or from settings recorded on another platform (⌃K on a
 * Mac is Ctrl+K, the palette's key elsewhere); only the first action in `keymap.ACTION_IDS` order
 * gets the key.
 */
export function sharedShortcuts(
  bindings: keymap.Bindings,
  platform: Platform,
): ReadonlyMap<ActionId, readonly SharedShortcut[]> {
  const shared = new Map<ActionId, SharedShortcut[]>()
  for (const conflict of keymap.findConflicts(bindings, platform)) {
    const actions = conflict.actions.filter((action) => !HIDDEN_ACTIONS.includes(action))
    if (actions.length < 2) continue
    for (const action of actions) {
      const list = shared.get(action) ?? []
      list.push({ label: conflict.combo, others: actions.filter((other) => other !== action) })
      shared.set(action, list)
    }
  }
  return shared
}

type MutableOverrides = Partial<Record<ActionId, readonly string[]>>

/** Sets `action`'s combos in `next`, dropping the override when they equal the defaults. */
function put(
  next: MutableOverrides,
  action: ActionId,
  list: readonly string[],
  platform: Platform,
): void {
  if (sameKeys(list, keymap.DEFAULT_BINDINGS[action], platform)) delete next[action]
  else next[action] = Object.freeze([...list])
}

/**
 * The overrides with `action` bound to `text` alone (its other combos dropped). Each action in
 * `moveFrom` loses every combo that matches the same key presses, so the key moves from them.
 */
export function withShortcut(
  overrides: settings.KeymapOverrides,
  action: ActionId,
  text: string,
  platform: Platform,
  moveFrom: readonly ActionId[] = [],
): settings.KeymapOverrides {
  const bindings = settings.bindingsWith(overrides)
  const next: MutableOverrides = { ...overrides }
  put(next, action, [text], platform)
  const combo = keymap.parseCombo(text, platform)
  for (const owner of moveFrom) {
    if (owner === action || combo === null) continue
    const kept = bindings[owner].filter((other) => {
      const parsed = keymap.parseCombo(other, platform)
      return parsed === null || !sameCombo(parsed, combo)
    })
    put(next, owner, kept, platform)
  }
  return Object.freeze(next)
}

/** The overrides with the combo bound as `text` taken off `action` (it may end up unbound). */
export function withoutShortcut(
  overrides: settings.KeymapOverrides,
  action: ActionId,
  text: string,
  platform: Platform,
): settings.KeymapOverrides {
  const bindings = settings.bindingsWith(overrides)
  const removed = keymap.parseCombo(text, platform)
  const kept = bindings[action].filter((other) => {
    if (other === text) return false
    const parsed = keymap.parseCombo(other, platform)
    return removed === null || parsed === null || !sameCombo(parsed, removed)
  })
  const next: MutableOverrides = { ...overrides }
  put(next, action, kept, platform)
  return Object.freeze(next)
}

/** The overrides without `action`'s: it gets its default shortcut back. */
export function withDefaultShortcut(
  overrides: settings.KeymapOverrides,
  action: ActionId,
): settings.KeymapOverrides {
  if (!Object.hasOwn(overrides, action)) return overrides
  const next: MutableOverrides = { ...overrides }
  delete next[action]
  return Object.freeze(next)
}
