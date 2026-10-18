/**
 * Settings › Desktop's rules (spec › Settings › Desktop, Keyboard › global hotkeys): the labels of
 * the close behaviors and the global hotkeys, what a key press recorded for a global hotkey means,
 * and what to say when the OS refuses one. Pure.
 *
 * A global hotkey works while other apps have the focus, so it must not be a key those apps need:
 * it needs Ctrl, Alt or Meta (⌘, ⌥ or ⌃ on a Mac); Shift alone would steal a capital letter
 * everywhere. Combos are stored in the keymap's portable text (`Mod+Shift+Space`), as rebinding
 * stores them.
 */
import { keymap, settings } from '../../core'
import { m } from '../../i18n'
import type { HotkeyResult } from '../../platform'
import { comboText, sameCombo } from './rebinding'

type HotkeyId = settings.HotkeyId

/**
 * Each close behavior's name in the select, in the UI language, for `platform`: the tray is the
 * menu bar on a Mac.
 */
export const CLOSE_BEHAVIOR_LABELS: Readonly<
  Record<settings.CloseBehavior, (platform: keymap.Platform) => string>
> = {
  'tray-while-running': (platform) =>
    platform === 'mac'
      ? m.desktop_close_menu_bar_while_running()
      : m.desktop_close_tray_while_running(),
  tray: (platform) => (platform === 'mac' ? m.desktop_close_menu_bar() : m.desktop_close_tray()),
  quit: () => m.desktop_close_quit(),
}

/** Each global hotkey's name, in the UI language. */
export const HOTKEY_LABELS: Readonly<Record<HotkeyId, () => string>> = {
  toggleLast: m.desktop_hotkey_toggle_last,
  showApp: m.desktop_hotkey_show_app,
}

/** What a key press recorded for a global hotkey means. */
export type HotkeyRecording =
  /** The key cannot be a shortcut at all (digits, Backspace, a bare modifier, an unknown key). */
  | { readonly kind: 'reserved'; readonly label: string }
  /** No Ctrl, Alt or Meta: it would take the key from every other app. */
  | { readonly kind: 'needs-modifier'; readonly label: string }
  /** The other global hotkey has this combo. */
  | { readonly kind: 'conflict'; readonly label: string; readonly other: HotkeyId }
  /** It can be bound: `text` is the portable binding text. */
  | { readonly kind: 'ok'; readonly label: string; readonly text: string }

/** The longest binding text kept (as `settings.migrateDesktopSettings` does). */
const MAX_TEXT_LENGTH = 64

/** The combo stored as `text`, or null when it does not parse (or there is none). */
function parsed(text: string | null, platform: keymap.Platform): keymap.KeyCombo | null {
  return text === null ? null : keymap.parseCombo(text, platform)
}

/**
 * Classifies `pressed`, recorded for global hotkey `id` while `hotkeys` are bound: refused when it
 * cannot be a shortcut or has no Ctrl, Alt or Meta, a conflict when the other hotkey has it, else
 * bindable. A character whose Shift depends on the layout (`?`) is taken without Shift, as the
 * keyboard settings do. The label is the combo's display text on `platform`.
 */
export function classifyHotkey(
  hotkeys: settings.DesktopHotkeys,
  id: HotkeyId,
  pressed: keymap.KeyCombo,
  platform: keymap.Platform,
): HotkeyRecording {
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
  if (!combo.ctrl && !combo.alt && !combo.meta) return { kind: 'needs-modifier', label }
  for (const other of settings.HOTKEY_IDS) {
    if (other === id) continue
    const held = parsed(hotkeys[other], platform)
    if (held !== null && sameCombo(held, combo)) return { kind: 'conflict', label, other }
  }
  return { kind: 'ok', label, text }
}

/** The display label of a stored combo on `platform` (`Ctrl+Shift+Space`, `⌘⇧Space`), or null. */
export function hotkeyLabel(text: string | null, platform: keymap.Platform): string | null {
  const combo = parsed(text, platform)
  return combo === null ? null : keymap.formatCombo(combo, platform)
}

/**
 * Why a recorded key cannot be a global hotkey without a modifier, naming the ones it needs one
 * of on `platform` (Ctrl, Alt or Meta; ⌘, ⌥ or ⌃ on a Mac), as the key labels name them.
 */
export function needsModifierMessage(platform: keymap.Platform): string {
  return platform === 'mac'
    ? m.desktop_hotkey_needs_modifier_mac()
    : m.desktop_hotkey_needs_modifier()
}

/** What to say when binding a global hotkey to `label` came to `result`; `''` for `ok`. */
export function hotkeyResultMessage(result: HotkeyResult, label: string): string {
  switch (result) {
    case 'ok':
      return ''
    case 'taken':
      return m.desktop_hotkey_taken({ key: label })
    case 'invalid':
      return m.desktop_hotkey_invalid({ key: label })
    case 'unsupported':
      return m.desktop_hotkey_unsupported()
  }
}
