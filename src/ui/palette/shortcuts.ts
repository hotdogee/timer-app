/**
 * Shortcut text for display: the labels the command palette shows next to each command and the
 * grouped rows of the keyboard cheat sheet (spec.md › Shortcuts). Pure; labels come from
 * `keymap.formatCombo`, so they follow the platform (`Ctrl+K` or `⌘K`) and the user's bindings.
 * Section titles and row labels are messages, read when `helpSections` runs, so they follow the
 * active locale; key labels are not translated.
 */
import { keymap } from '../../core'
import { m } from '../../i18n'

/** A cheat-sheet row: a description and the actions (or fixed keys) that do it. */
export interface HelpRowSpec {
  /** The description, as a message read when the sheet is built. */
  readonly label: () => string
  /** Rebindable actions; the row shows the first combo of each when there are several. */
  readonly actions?: readonly keymap.ActionId[]
  /** Keys that are not rebindable (digit entry), shown as written. */
  readonly fixed?: readonly string[]
}

export interface HelpSectionSpec {
  /** The section title, as a message read when the sheet is built. */
  readonly title: () => string
  readonly rows: readonly HelpRowSpec[]
}

/** A cheat-sheet row ready to show. */
export interface HelpRow {
  readonly label: string
  /**
   * Modifiers that every key of a multi-action row shares, shown once in front (`Ctrl` for
   * Ctrl+←, Ctrl+→, …; `⌃` on macOS). Absent when the keys have no common modifiers.
   */
  readonly modifier?: string
  /** One label per key combo, without the shared modifier. */
  readonly keys: readonly string[]
}

export interface HelpSection {
  readonly title: string
  readonly rows: readonly HelpRow[]
}

/**
 * What the cheat sheet lists, by group. Every action appears except `miniWindow`, which stays
 * hidden until the mini window ships (M5).
 */
export const HELP_SECTIONS: readonly HelpSectionSpec[] = [
  {
    title: m.help_section_timer,
    rows: [
      { label: m.help_type_duration, fixed: ['0–9'] },
      { label: m.help_delete_digit, fixed: ['Backspace'] },
      { label: m.help_start_pause, actions: ['toggle'] },
      { label: m.help_start_dismiss, actions: ['start'] },
      { label: m.help_dismiss, actions: ['dismiss'] },
      { label: m.help_reset, actions: ['reset'] },
    ],
  },
  {
    title: m.help_section_stopwatch,
    rows: [
      { label: m.help_start_pause, actions: ['toggle'] },
      { label: m.help_lap, actions: ['lap'] },
      { label: m.help_reset, actions: ['reset'] },
    ],
  },
  {
    title: m.help_section_cards,
    rows: [
      { label: m.help_new_timer, actions: ['newTimer'] },
      { label: m.help_new_stopwatch, actions: ['newStopwatch'] },
      { label: m.help_presets, actions: ['presets'] },
      { label: m.help_rename, actions: ['rename'] },
      { label: m.help_mute, actions: ['mute'] },
      { label: m.help_fullscreen, actions: ['fullscreen'] },
      { label: m.help_delete, actions: ['deleteCard'] },
      { label: m.help_undo, actions: ['undo'] },
    ],
  },
  {
    title: m.help_section_navigation,
    rows: [
      {
        label: m.help_select,
        actions: ['selectLeft', 'selectRight', 'selectUp', 'selectDown'],
      },
      { label: m.help_move, actions: ['moveLeft', 'moveRight', 'moveUp', 'moveDown'] },
    ],
  },
  {
    title: m.help_section_app,
    rows: [
      { label: m.help_palette, actions: ['palette'] },
      { label: m.help_shortcuts, actions: ['help'] },
      { label: m.help_settings, actions: ['settings'] },
      { label: m.help_edit_mode, actions: ['editMode'] },
      { label: m.help_cancel, actions: ['cancel'] },
    ],
  },
]

/** The parsable combos bound to `action`, in binding order. */
function combosOf(
  bindings: keymap.Bindings,
  action: keymap.ActionId,
  platform: keymap.Platform,
): keymap.KeyCombo[] {
  return keymap.parsedCombos(bindings, action, platform).map(({ combo }) => combo)
}

/**
 * The display labels of every combo bound to `action`, in binding order, on `platform`. Binding
 * text that does not parse is skipped, and an action with no bindings gives an empty list.
 */
export function comboLabels(
  bindings: keymap.Bindings,
  action: keymap.ActionId,
  platform: keymap.Platform,
): readonly string[] {
  const labels: string[] = []
  for (const combo of combosOf(bindings, action, platform)) {
    const label = keymap.formatCombo(combo, platform)
    if (!labels.includes(label)) labels.push(label)
  }
  return labels
}

/**
 * Splits combos that all have the same, non-empty modifiers into that modifier text and the bare
 * key labels: Ctrl+←, Ctrl+→ give `Ctrl` and `←`, `→`. `null` when the modifiers differ or are
 * empty, or there are fewer than two combos.
 */
function splitSharedModifier(
  combos: readonly keymap.KeyCombo[],
  platform: keymap.Platform,
): { modifier: string; keys: string[] } | null {
  const [first] = combos
  if (combos.length < 2 || first === undefined) return null
  if (!first.ctrl && !first.alt && !first.shift && !first.meta) return null
  const same = combos.every(
    (c) =>
      c.ctrl === first.ctrl &&
      c.alt === first.alt &&
      c.shift === first.shift &&
      c.meta === first.meta,
  )
  if (!same) return null
  const bare = (c: keymap.KeyCombo): string =>
    keymap.formatCombo({ key: c.key, ctrl: false, alt: false, shift: false, meta: false }, platform)
  const full = keymap.formatCombo(first, platform)
  const key = bare(first)
  if (!full.endsWith(key)) return null
  const prefix = full.slice(0, full.length - key.length)
  return { modifier: prefix.endsWith('+') ? prefix.slice(0, -1) : prefix, keys: combos.map(bare) }
}

/** The label of the first combo bound to `action`, or `null` when it has none. */
export function shortcutLabel(
  bindings: keymap.Bindings,
  action: keymap.ActionId,
  platform: keymap.Platform,
): string | null {
  return comboLabels(bindings, action, platform)[0] ?? null
}

/**
 * The cheat sheet for these bindings on `platform`. A row of one action lists all its combos; a
 * row of several actions (the arrows) lists the first combo of each, with modifiers they all share
 * pulled out into `modifier`. Rows with no key, such as an unbound action, are left out, and so
 * are sections left empty.
 */
export function helpSections(
  bindings: keymap.Bindings,
  platform: keymap.Platform,
  sections: readonly HelpSectionSpec[] = HELP_SECTIONS,
): readonly HelpSection[] {
  const out: HelpSection[] = []
  for (const section of sections) {
    const rows: HelpRow[] = []
    for (const row of section.rows) {
      const actions = row.actions ?? []
      const [only] = actions
      if (actions.length === 1 && only !== undefined) {
        const keys = [...(row.fixed ?? []), ...comboLabels(bindings, only, platform)]
        if (keys.length > 0) rows.push({ label: row.label(), keys })
        continue
      }
      const combos = actions.flatMap((action) => combosOf(bindings, action, platform).slice(0, 1))
      const shared = splitSharedModifier(combos, platform)
      if (shared !== null && row.fixed === undefined) {
        rows.push({ label: row.label(), ...shared })
        continue
      }
      const keys = [
        ...(row.fixed ?? []),
        ...combos.map((combo) => keymap.formatCombo(combo, platform)),
      ]
      if (keys.length > 0) rows.push({ label: row.label(), keys })
    }
    if (rows.length > 0) out.push({ title: section.title(), rows })
  }
  return out
}
