/**
 * Global hotkeys between the app and the global-shortcut plugin: the keymap's portable binding
 * text (`'Mod+Shift+Space'`, see `core/keymap.ts`) as the plugin's accelerator
 * (`'CommandOrControl+Shift+Space'`), and the plugin's error messages as a {@link HotkeyResult}.
 * Pure: no Tauri imports, so it is tested in Node and costs the web bundle nothing but text.
 */
import { parseCombo } from '../../core/keymap'
import type { HotkeyResult } from '../types'

/** Printable keys by `KeyboardEvent.key`, as the plugin's physical key codes (US layout). */
const PUNCTUATION: ReadonlyMap<string, string> = new Map([
  ['`', 'Backquote'],
  ['\\', 'Backslash'],
  ['[', 'BracketLeft'],
  [']', 'BracketRight'],
  [',', 'Comma'],
  ['=', 'Equal'],
  ['-', 'Minus'],
  ['.', 'Period'],
  ["'", 'Quote'],
  [';', 'Semicolon'],
  ['/', 'Slash'],
  [' ', 'Space'],
])

/** Named keys whose `KeyboardEvent.key` the plugin knows by the same name. */
const NAMED_KEYS = new Set([
  'Enter',
  'Tab',
  'Escape',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PrintScreen',
  'ScrollLock',
  'Pause',
])

/**
 * Keys that may be a global hotkey without Ctrl, Alt or Meta: they type nothing, so binding one
 * alone does not take a key away from typing in every other app.
 */
const STANDALONE_KEYS = new Set([
  'MediaPlayPause',
  'MediaPlay',
  'MediaPause',
  'MediaStop',
  'MediaTrackNext',
  'MediaTrackPrevious',
  'AudioVolumeUp',
  'AudioVolumeDown',
  'AudioVolumeMute',
])

/** F1–F24, as `parseCombo` normalizes them. */
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/

/** The plugin's key code for a normalized `KeyboardEvent.key`, or null when it has none. */
function keyCode(key: string): string | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  const printable = PUNCTUATION.get(key)
  if (printable !== undefined) return printable
  return NAMED_KEYS.has(key) || STANDALONE_KEYS.has(key) || FUNCTION_KEY.test(key) ? key : null
}

/**
 * The global-shortcut accelerator for binding text, or null when the combo cannot be a global
 * hotkey:
 * - text that does not parse, or a key with no physical key code: a character typed with Shift
 *   on some layout (`?`, `+`, `@`), a letter outside A–Z, `ContextMenu`, a lock key;
 * - a key without Ctrl, Alt or Meta, which would stop it from typing in every other app, except
 *   the function keys F1–F24 and the media and volume keys.
 *
 * `Mod` becomes `CommandOrControl`, so the plugin picks Cmd on macOS and Ctrl elsewhere; explicit
 * modifiers keep their names (`Meta` is `Super`: Cmd on macOS, the Windows key elsewhere).
 */
export function toAccelerator(binding: string): string | null {
  // `Mod` is Ctrl in the 'other' reading and Meta in the 'mac' one; a modifier written out is the
  // same in both. Comparing the two readings tells which modifiers came from `Mod`.
  const other = parseCombo(binding, 'other')
  const mac = parseCombo(binding, 'mac')
  if (other === null || mac === null) return null
  const code = keyCode(other.key)
  if (code === null) return null
  const mod = (other.ctrl && !mac.ctrl) || (mac.meta && !other.meta)
  const ctrl = mac.ctrl
  const meta = other.meta
  if (
    !mod &&
    !ctrl &&
    !meta &&
    !other.alt &&
    !STANDALONE_KEYS.has(code) &&
    !FUNCTION_KEY.test(code)
  ) {
    return null
  }
  const parts: string[] = []
  if (mod) parts.push('CommandOrControl')
  if (ctrl) parts.push('Control')
  if (meta) parts.push('Super')
  if (other.alt) parts.push('Alt')
  if (other.shift) parts.push('Shift')
  parts.push(code)
  return parts.join('+')
}

/** The text of a failed plugin call: Tauri commands reject with a string, JavaScript with Error. */
export function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  return String(error)
}

/** Errors the OS gives when another app (or the OS) holds the combo. */
const TAKEN = /already registered|RegisterEventHotKey failed/i

/** Errors for a combo the plugin cannot parse or the OS has no key for. */
const INVALID =
  /couldn't recognize|invalid hotkey format|empty token|unexpected hotkey|unknown (vkcode|scancode)|unable to find keycode/i

/**
 * What a failed `register` means: `'taken'` when the OS refused because the combo is in use,
 * `'invalid'` when it has no such key, or null for any other failure (the plugin itself failed).
 */
export function registerFailure(error: unknown): Extract<HotkeyResult, 'taken' | 'invalid'> | null {
  const text = errorText(error)
  if (TAKEN.test(text)) return 'taken'
  if (INVALID.test(text)) return 'invalid'
  return null
}
