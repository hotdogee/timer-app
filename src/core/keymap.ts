/**
 * Keymap: shortcut bindings as text, parsed into key combos and matched against keyboard events
 * (spec.md › Keyboard). Pure: no DOM, no listeners. The keyboard controller in `src/state` feeds
 * it events and runs the action it resolves.
 *
 * Binding text is `Modifier+…+Key`, e.g. `'Mod+K'`, `'Shift+N'`, `'Ctrl+ArrowLeft'`, `'Space'`,
 * `'?'`. Modifiers are `Ctrl`, `Alt`, `Shift`, `Meta` and `Mod` (Cmd on macOS, Ctrl elsewhere),
 * case-insensitively, with the aliases `Control`, `Option`, `Opt`, `Cmd`, `Command`, `Win` and
 * `Super`. Keys are `KeyboardEvent.key` values; single letters are case-insensitive, and the
 * aliases `Space`, `Esc`, `Del`, `Return` and `Up`/`Down`/`Left`/`Right` work. The macOS display
 * form (`'⌘K'`, `'⌃←'`) parses too, so {@link formatCombo} output round-trips.
 *
 * Digits and Backspace pressed without Ctrl, Alt or Meta belong to digit entry and never resolve
 * to an action, whatever the bindings say.
 *
 * Functions never throw, including for malformed or non-string input from untyped code.
 */

/** The platform convention for modifiers: `Mod` and the display form follow it. */
export type Platform = 'mac' | 'other'

/** One key with an exact set of modifiers. `key` is normalized (see {@link comboFromEvent}). */
export interface KeyCombo {
  readonly key: string
  readonly ctrl: boolean
  readonly alt: boolean
  readonly shift: boolean
  readonly meta: boolean
}

/** The part of a `KeyboardEvent` the keymap reads. */
export interface KeyEventLike {
  readonly key: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

/** Every bindable action. The keyboard controller decides what each one does in context. */
export type ActionId =
  | 'toggle'
  | 'start'
  | 'reset'
  | 'dismiss'
  | 'lap'
  | 'newTimer'
  | 'newStopwatch'
  | 'deleteCard'
  | 'undo'
  | 'rename'
  | 'editMode'
  | 'fullscreen'
  | 'mute'
  | 'miniWindow'
  | 'presets'
  | 'palette'
  | 'help'
  | 'selectLeft'
  | 'selectRight'
  | 'selectUp'
  | 'selectDown'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown'
  | 'cancel'

/** The binding text for each action; an action may have several combos or none. */
export type Bindings = Readonly<Record<ActionId, readonly string[]>>

/** Every action, in a stable order: {@link resolveAction} tries them in this order. */
export const ACTION_IDS: readonly ActionId[] = Object.freeze([
  'toggle',
  'start',
  'reset',
  'dismiss',
  'lap',
  'newTimer',
  'newStopwatch',
  'deleteCard',
  'undo',
  'rename',
  'editMode',
  'fullscreen',
  'mute',
  'miniWindow',
  'presets',
  'palette',
  'help',
  'selectLeft',
  'selectRight',
  'selectUp',
  'selectDown',
  'moveLeft',
  'moveRight',
  'moveUp',
  'moveDown',
  'cancel',
] as const)

/**
 * The default shortcuts (spec › Shortcuts and the M2 keyboard decisions). `dismiss` has no key of
 * its own: Enter starts or dismisses. Moving a card uses Ctrl+Arrow on every platform, because
 * Cmd+Arrow is taken on macOS.
 */
export const DEFAULT_BINDINGS: Bindings = Object.freeze({
  toggle: Object.freeze(['Space']),
  start: Object.freeze(['Enter']),
  reset: Object.freeze(['r']),
  dismiss: Object.freeze([]),
  lap: Object.freeze(['l']),
  newTimer: Object.freeze(['n']),
  newStopwatch: Object.freeze(['Shift+N']),
  deleteCard: Object.freeze(['Delete']),
  undo: Object.freeze(['Mod+Z']),
  rename: Object.freeze(['F2']),
  editMode: Object.freeze(['e']),
  fullscreen: Object.freeze(['f']),
  mute: Object.freeze(['m']),
  miniWindow: Object.freeze(['t']),
  presets: Object.freeze(['p']),
  palette: Object.freeze(['Mod+K']),
  help: Object.freeze(['?']),
  selectLeft: Object.freeze(['ArrowLeft']),
  selectRight: Object.freeze(['ArrowRight']),
  selectUp: Object.freeze(['ArrowUp']),
  selectDown: Object.freeze(['ArrowDown']),
  moveLeft: Object.freeze(['Ctrl+ArrowLeft']),
  moveRight: Object.freeze(['Ctrl+ArrowRight']),
  moveUp: Object.freeze(['Ctrl+ArrowUp']),
  moveDown: Object.freeze(['Ctrl+ArrowDown']),
  cancel: Object.freeze(['Escape']),
})

type Modifier = 'ctrl' | 'alt' | 'shift' | 'meta'

/** Modifier names in binding text, lowercased. `mod` is resolved per platform. */
const MODIFIER_NAMES: ReadonlyMap<string, Modifier | 'mod'> = new Map([
  ['ctrl', 'ctrl'],
  ['control', 'ctrl'],
  ['alt', 'alt'],
  ['option', 'alt'],
  ['opt', 'alt'],
  ['shift', 'shift'],
  ['meta', 'meta'],
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['win', 'meta'],
  ['super', 'meta'],
  ['mod', 'mod'],
] as const)

/** The macOS modifier symbols, in Apple's display order: Control, Option, Shift, Command. */
const MAC_SYMBOLS: readonly (readonly [Modifier, string])[] = [
  ['ctrl', '⌃'],
  ['alt', '⌥'],
  ['shift', '⇧'],
  ['meta', '⌘'],
]

/** Modifier names for the non-mac display form, in the Windows order. */
const OTHER_NAMES: readonly (readonly [Modifier, string])[] = [
  ['ctrl', 'Ctrl'],
  ['alt', 'Alt'],
  ['shift', 'Shift'],
  ['meta', 'Meta'],
]

// The lookup tables are Maps, not object literals: text such as '__proto__' or 'constructor' must
// not find Object.prototype members.

/** Named keys by lowercased name or alias, to their `KeyboardEvent.key` value. */
const NAMED_KEYS: ReadonlyMap<string, string> = new Map([
  ['space', ' '],
  ['spacebar', ' '],
  ['esc', 'Escape'],
  ['escape', 'Escape'],
  ['enter', 'Enter'],
  ['return', 'Enter'],
  ['tab', 'Tab'],
  ['backspace', 'Backspace'],
  ['del', 'Delete'],
  ['delete', 'Delete'],
  ['insert', 'Insert'],
  ['home', 'Home'],
  ['end', 'End'],
  ['pageup', 'PageUp'],
  ['pagedown', 'PageDown'],
  ['up', 'ArrowUp'],
  ['arrowup', 'ArrowUp'],
  ['down', 'ArrowDown'],
  ['arrowdown', 'ArrowDown'],
  ['left', 'ArrowLeft'],
  ['arrowleft', 'ArrowLeft'],
  ['right', 'ArrowRight'],
  ['arrowright', 'ArrowRight'],
  ['contextmenu', 'ContextMenu'],
])

/** Arrow glyphs, which the display form uses and the parser accepts. */
const ARROW_GLYPHS: ReadonlyMap<string, string> = new Map([
  ['←', 'ArrowLeft'],
  ['↑', 'ArrowUp'],
  ['→', 'ArrowRight'],
  ['↓', 'ArrowDown'],
])

/** Display labels that differ from the key value. */
const KEY_LABELS: ReadonlyMap<string, string> = new Map([
  [' ', 'Space'],
  ['Escape', 'Esc'],
  ['ArrowLeft', '←'],
  ['ArrowUp', '↑'],
  ['ArrowRight', '→'],
  ['ArrowDown', '↓'],
])

/** The keys that are modifiers themselves, which cannot be the key of a combo. */
const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'Hyper',
  'Super',
])

/** Function keys F1–F24, any case. */
const FUNCTION_KEY = /^f([1-9]|1[0-9]|2[0-4])$/i

/** Other `KeyboardEvent.key` names in their exact PascalCase form, e.g. `MediaPlayPause`. */
const KEY_NAME = /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*$/

/** Exactly one ASCII digit, as `KeyboardEvent.key` reports for the digit row and the numpad. */
const DIGIT = /^[0-9]$/

/** The number of code points in `s`, so an astral character counts as one. */
function codePoints(s: string): number {
  return [...s].length
}

/** Whether `ch` (one character) has distinct upper and lower case, i.e. is a cased letter. */
function isCased(ch: string): boolean {
  return ch.toLowerCase() !== ch.toUpperCase()
}

/**
 * The normalized `KeyboardEvent.key` for a key name or character, or `null` when it is not a key:
 * a single character stays as it is, lowercased if it is a letter (arrow glyphs become arrow
 * keys); named keys and their aliases match case-insensitively; F1–F24 any case; other key names
 * must be PascalCase. Modifiers (`Shift`, `Ctrl`, `⌘`, …) are not keys of a combo.
 */
function canonicalKey(token: string): string | null {
  if (token === '' || MAC_SYMBOLS.some(([, symbol]) => symbol === token)) return null
  const lower = token.toLowerCase()
  if (codePoints(token) === 1) {
    // Keep a letter whose lower case is two characters (İ → i̇), which would not parse back.
    return ARROW_GLYPHS.get(token) ?? (codePoints(lower) === 1 ? lower : token)
  }
  const named = NAMED_KEYS.get(lower)
  if (named !== undefined) return named
  if (MODIFIER_NAMES.has(lower) || MODIFIER_KEYS.has(token)) return null
  const fn = FUNCTION_KEY.exec(token)
  if (fn !== null) return `F${fn[1] ?? ''}`
  return KEY_NAME.test(token) ? token : null
}

/**
 * Whether Shift is ignored when matching `key`: a printable character with no case, such as `?`
 * or `+`, already says whether Shift was needed to type it, and that differs between layouts.
 * Letters (Shift+N is not N) and Space keep an exact Shift.
 */
function shiftInsensitive(key: string): boolean {
  return key !== ' ' && codePoints(key) === 1 && !isCased(key)
}

function combo(key: string, mods: ReadonlySet<Modifier>): KeyCombo {
  return {
    key,
    ctrl: mods.has('ctrl'),
    alt: mods.has('alt'),
    shift: mods.has('shift'),
    meta: mods.has('meta'),
  }
}

/**
 * Parses binding text into a combo, or returns `null` when it is malformed: empty, an unknown
 * modifier, a modifier with no key, a bare modifier key, or an unknown key name. Accepts
 * `'Mod+K'`, `'Shift+N'`, `'ctrl+arrowleft'`, `'F2'`, `'?'`, `'Ctrl++'` (the `+` key), `' '` or
 * `'Space'`, and the macOS display form (`'⌘⇧K'`). `Mod` is Meta on `'mac'` and Ctrl elsewhere.
 * Letters are lowercased, so `'N'` is the N key without Shift; repeating a modifier is harmless.
 */
export function parseCombo(text: string, platform: Platform): KeyCombo | null {
  if (typeof text !== 'string') return null
  if (text === ' ') return combo(' ', new Set())
  let rest = text.trim()
  const mods = new Set<Modifier>()
  // The macOS display form: modifier symbols first, then the key with no separators.
  for (;;) {
    const symbol = MAC_SYMBOLS.find(([, s]) => rest.startsWith(s))
    if (symbol === undefined) break
    mods.add(symbol[0])
    rest = rest.slice(symbol[1].length)
  }
  if (rest === '') return null
  // A trailing '+' is the + key; what precedes it must end with a '+' separator, or be empty.
  let keyToken: string
  let modTokens: string[]
  if (rest.endsWith('+')) {
    const head = rest.slice(0, -1)
    if (head !== '' && !head.endsWith('+')) return null
    keyToken = '+'
    modTokens = head === '' ? [] : head.slice(0, -1).split('+')
  } else {
    const tokens = rest.split('+')
    keyToken = tokens.pop()?.trim() ?? ''
    modTokens = tokens
  }
  for (const token of modTokens) {
    const name = MODIFIER_NAMES.get(token.trim().toLowerCase())
    if (name === undefined) return null
    mods.add(name === 'mod' ? (platform === 'mac' ? 'meta' : 'ctrl') : name)
  }
  const key = canonicalKey(keyToken)
  return key === null ? null : combo(key, mods)
}

/** The display label of a normalized key: `Space`, `Esc`, arrow glyphs, upper-case letters. */
function keyLabel(key: string): string {
  const label = KEY_LABELS.get(key)
  if (label !== undefined) return label
  if (codePoints(key) !== 1) return key
  const upper = key.toUpperCase()
  // Only an upper case that lowercases back to the key parses back to it: not ß → SS, nor the
  // Cyrillic variant ᲀ → В → в.
  return upper.toLowerCase() === key ? upper : key
}

/**
 * Formats a combo for display: `'Ctrl+Shift+K'` style elsewhere and `'⌃⌥⇧⌘K'` style on macOS,
 * with `Space`, `Esc`, `↑`/`↓`/`←`/`→` and upper-case letters. {@link parseCombo} reads the result
 * back to the same combo on the same platform.
 */
export function formatCombo(combo: KeyCombo, platform: Platform): string {
  const key = keyLabel(canonicalKey(combo.key) ?? combo.key)
  if (platform === 'mac') {
    return MAC_SYMBOLS.map(([mod, symbol]) => (combo[mod] ? symbol : '')).join('') + key
  }
  return [...OTHER_NAMES.filter(([mod]) => combo[mod]).map(([, name]) => name), key].join('+')
}

/**
 * The combo a keyboard event represents. Letters are lowercased (Shift+N and Caps Lock N give
 * `n`; Shift stays a separate flag) and legacy key names are normalized (`'Spacebar'` → `' '`,
 * `'Esc'` → `'Escape'`, `'Left'` → `'ArrowLeft'`, `'Del'` → `'Delete'`).
 */
export function comboFromEvent(e: KeyEventLike): KeyCombo {
  const raw = typeof e.key === 'string' ? e.key : ''
  return {
    key: canonicalKey(raw) ?? raw,
    ctrl: e.ctrlKey === true,
    alt: e.altKey === true,
    shift: e.shiftKey === true,
    meta: e.metaKey === true,
  }
}

/**
 * Whether event `e` triggers `combo`. The key and Ctrl, Alt and Meta must match exactly, so Ctrl+R
 * does not trigger R. Shift must match too, except for printable characters without case, which
 * already include it: a `?` binding matches `?` typed with or without Shift.
 */
export function matches(combo: KeyCombo, e: KeyEventLike): boolean {
  return matchesPressed(combo, comboFromEvent(e))
}

/** {@link matches} for an event already normalized by {@link comboFromEvent}. */
function matchesPressed(combo: KeyCombo, pressed: KeyCombo): boolean {
  const key = canonicalKey(combo.key) ?? combo.key
  return (
    pressed.key === key &&
    pressed.ctrl === combo.ctrl &&
    pressed.alt === combo.alt &&
    pressed.meta === combo.meta &&
    (pressed.shift === combo.shift || shiftInsensitive(key))
  )
}

/** Whether `e` is a digit or Backspace without Ctrl, Alt or Meta: digit entry, never an action. */
function isDigitEntry(e: KeyEventLike): boolean {
  return (isDigitKey(e.key) || e.key === 'Backspace') && !e.ctrlKey && !e.altKey && !e.metaKey
}

interface CompiledBinding {
  readonly action: ActionId
  readonly combo: KeyCombo
}

/** Parsed bindings per bindings object and platform, so keydown does not parse text each time. */
const compiled = new WeakMap<Bindings, Partial<Record<Platform, readonly CompiledBinding[]>>>()

/** The parsable combos of `bindings` in {@link ACTION_IDS} order; malformed text is skipped. */
function compile(bindings: Bindings, platform: Platform): readonly CompiledBinding[] {
  const cache = compiled.get(bindings) ?? {}
  const hit = cache[platform]
  if (hit !== undefined) return hit
  const out: CompiledBinding[] = []
  for (const action of ACTION_IDS) {
    const texts: unknown = bindings[action]
    if (!Array.isArray(texts)) continue
    for (const text of texts as unknown[]) {
      const parsed = typeof text === 'string' ? parseCombo(text, platform) : null
      if (parsed !== null) out.push({ action, combo: parsed })
    }
  }
  cache[platform] = out
  compiled.set(bindings, cache)
  return out
}

/**
 * The action bound to event `e`, or `null` when no binding matches. Digits and Backspace without
 * Ctrl, Alt or Meta always give `null` (digit entry). When several actions match, the first in
 * {@link ACTION_IDS} order wins; {@link findConflicts} reports such overlaps. Malformed binding
 * text is ignored. Results are cached per `bindings` object, so treat bindings as immutable.
 */
export function resolveAction(
  bindings: Bindings,
  e: KeyEventLike,
  platform: Platform,
): ActionId | null {
  if (typeof bindings !== 'object' || bindings === null || isDigitEntry(e)) return null
  const pressed = comboFromEvent(e)
  for (const { action, combo } of compile(bindings, platform)) {
    if (matchesPressed(combo, pressed)) return action
  }
  return null
}

/** A key that identifies what a combo matches: `?` and `Shift+?` are the same. */
function matchKey(c: KeyCombo): string {
  const shift = shiftInsensitive(c.key) ? '*' : c.shift ? '1' : '0'
  return `${c.ctrl ? '1' : '0'}${c.alt ? '1' : '0'}${shift}${c.meta ? '1' : '0'}:${c.key}`
}

/**
 * Combos bound to more than one action on `platform`, each with its display text
 * ({@link formatCombo}) and the actions in {@link ACTION_IDS} order. Combos that match the same
 * events count as one (`Mod+K` and `Ctrl+K` elsewhere; `?` and `Shift+?`). An action listing a
 * combo twice is not a conflict. Malformed binding text is ignored.
 */
export function findConflicts(
  bindings: Bindings,
  platform: Platform,
): readonly { combo: string; actions: readonly ActionId[] }[] {
  if (typeof bindings !== 'object' || bindings === null) return []
  const groups = new Map<string, { combo: KeyCombo; actions: ActionId[] }>()
  for (const { action, combo } of compile(bindings, platform)) {
    const id = matchKey(combo)
    const group = groups.get(id)
    if (group === undefined) groups.set(id, { combo, actions: [action] })
    else if (!group.actions.includes(action)) group.actions.push(action)
  }
  return [...groups.values()]
    .filter((group) => group.actions.length > 1)
    .map((group) => ({ combo: formatCombo(group.combo, platform), actions: group.actions }))
}

/**
 * Whether `key` (a `KeyboardEvent.key`) is a single ASCII digit, `'0'`–`'9'`, from the digit row
 * or the numpad. Locale digits and key names such as `'Numpad5'` are not.
 */
export function isDigitKey(key: string): boolean {
  return typeof key === 'string' && DIGIT.test(key)
}
