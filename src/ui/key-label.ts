/**
 * Splits a key combo's display label (`keymap.formatCombo`: `Ctrl+↑`, `⌃←`) into text and arrow
 * keys, so key caps can draw the arrows as icons. No font the app loads has all four arrows at one
 * width: Roboto Flex's latin subset has none, and the system fallbacks mix glyphs from different
 * fonts (narrow ↑ ↓ beside wide ← →).
 */
import type { IconName } from './primitives/icons'

/** One piece of a key label: plain text, or an arrow key with its character. */
export interface KeyLabelPart {
  readonly text: string
  /** The icon that draws this arrow; absent for plain text. */
  readonly arrow?: IconName
}

const ARROWS: Readonly<Record<string, IconName>> = {
  '←': 'arrow_back',
  '→': 'arrow_forward',
  '↑': 'arrow_upward',
  '↓': 'arrow_downward',
}

/** `label` as runs of text and single arrow keys, in order; `''` gives no parts. */
export function keyLabelParts(label: string): readonly KeyLabelPart[] {
  const parts: KeyLabelPart[] = []
  let text = ''
  for (const char of label) {
    const arrow = ARROWS[char]
    if (arrow === undefined) {
      text += char
      continue
    }
    if (text !== '') parts.push({ text })
    text = ''
    parts.push({ text: char, arrow })
  }
  if (text !== '') parts.push({ text })
  return parts
}
