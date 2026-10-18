/**
 * The settings dialog's sections (spec › Settings) in display order, their titles and icons, and
 * keyboard movement in the section tab list. Desktop exists only in the desktop app.
 */
import { m } from '../../i18n'
import type { PlatformKind } from '../../platform'
import type { GlyphName } from './icons'

export type SectionId =
  'appearance' | 'behavior' | 'keyboard' | 'desktop' | 'presets' | 'data' | 'account' | 'about'

/** Every section, in the order the dialog lists them. Frozen. */
export const SECTION_IDS: readonly SectionId[] = Object.freeze([
  'appearance',
  'behavior',
  'keyboard',
  'desktop',
  'presets',
  'data',
  'account',
  'about',
])

const TITLES: Readonly<Record<SectionId, () => string>> = {
  appearance: m.settings_section_appearance,
  behavior: m.settings_section_behavior,
  keyboard: m.settings_section_keyboard,
  desktop: m.settings_section_desktop,
  presets: m.settings_section_presets,
  data: m.settings_section_data,
  account: m.settings_section_account,
  about: m.settings_section_about,
}

/** Each section's icon in the section list. */
export const SECTION_ICONS: Readonly<Record<SectionId, GlyphName>> = Object.freeze({
  appearance: 'palette',
  behavior: 'tune',
  keyboard: 'keyboard',
  desktop: 'desktop_windows',
  presets: 'bookmarks',
  data: 'database',
  account: 'account_circle',
  about: 'info',
})

/** The sections that only the desktop app has. */
const DESKTOP_ONLY: ReadonlySet<SectionId> = new Set(['desktop'])

const WEB_SECTION_IDS: readonly SectionId[] = Object.freeze(
  SECTION_IDS.filter((id) => !DESKTOP_ONLY.has(id)),
)

/** The sections the dialog lists in shell `kind`: all on desktop, all but Desktop on the web. */
export function sectionsFor(kind: PlatformKind): readonly SectionId[] {
  return kind === 'tauri' ? SECTION_IDS : WEB_SECTION_IDS
}

/** The id of a section's tab in the dialog whose ids start with `prefix`. */
export function tabId(prefix: string, section: SectionId): string {
  return `${prefix}-tab-${section}`
}

/** The section's title in the active locale. */
export function sectionTitle(id: SectionId): string {
  return TITLES[id]()
}

/** Whether `value` names a section. */
export function isSectionId(value: unknown): value is SectionId {
  return (SECTION_IDS as readonly unknown[]).includes(value)
}

/**
 * The index of the tab that `key` moves to in a tab list of `count` tabs, from the tab at `index`:
 * the arrows go to the previous or next tab and wrap around (both pairs work, whichever way the
 * list is laid out), Home and End go to the first and last. `null` for any other key or an empty
 * list.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null
  const from = Math.min(Math.max(Math.trunc(index) || 0, 0), count - 1)
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      return (from + 1) % count
    case 'ArrowUp':
    case 'ArrowLeft':
      return (from - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
