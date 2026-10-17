/**
 * Localized names for the values of core enums that the UI lists: keyboard actions (the
 * rebinding list) and the reasons an import fails. Each table covers every value, so adding an
 * action or a reason without a message is a type error. Call these when the text is shown.
 */
import type { exportFormat, keymap } from '../core'
import { m } from './messages.svelte'

const ACTION_NAMES: Readonly<Record<keymap.ActionId, () => string>> = {
  toggle: m.shortcut_action_toggle,
  start: m.shortcut_action_start,
  reset: m.shortcut_action_reset,
  dismiss: m.shortcut_action_dismiss,
  lap: m.shortcut_action_lap,
  newTimer: m.shortcut_action_new_timer,
  newStopwatch: m.shortcut_action_new_stopwatch,
  deleteCard: m.shortcut_action_delete_card,
  undo: m.shortcut_action_undo,
  rename: m.shortcut_action_rename,
  editMode: m.shortcut_action_edit_mode,
  fullscreen: m.shortcut_action_fullscreen,
  mute: m.shortcut_action_mute,
  miniWindow: m.shortcut_action_mini_window,
  presets: m.shortcut_action_presets,
  palette: m.shortcut_action_palette,
  help: m.shortcut_action_help,
  settings: m.shortcut_action_settings,
  selectLeft: m.shortcut_action_select_left,
  selectRight: m.shortcut_action_select_right,
  selectUp: m.shortcut_action_select_up,
  selectDown: m.shortcut_action_select_down,
  moveLeft: m.shortcut_action_move_left,
  moveRight: m.shortcut_action_move_right,
  moveUp: m.shortcut_action_move_up,
  moveDown: m.shortcut_action_move_down,
  cancel: m.shortcut_action_cancel,
}

/** What keyboard action `action` does, in the active locale ("Start or pause"). */
export function actionName(action: keymap.ActionId): string {
  return ACTION_NAMES[action]()
}

const IMPORT_ERRORS: Readonly<Record<exportFormat.ExportErrorReason, () => string>> = {
  'too-large': m.data_import_error_too_large,
  'not-json': m.data_import_error_not_json,
  'not-export': m.data_import_error_not_export,
  'newer-format': m.data_import_error_newer_format,
  invalid: m.data_import_error_invalid,
}

/** Why a file could not be imported (`parseExport`'s `reason`), in the active locale. */
export function importErrorMessage(reason: exportFormat.ExportErrorReason): string {
  return IMPORT_ERRORS[reason]()
}
