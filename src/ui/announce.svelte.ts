/**
 * The app's polite announcements (spec › Accessibility): `announce(text)` from anywhere, and the one
 * live region (`Announcer.svelte`, rendered once by App) speaks it after whatever the screen reader
 * is saying. Announce state changes (start, pause, time's up, card added), never per-second
 * updates. A plain module rather than a component export, so TypeScript callers get real types.
 */

/** U+00A0 NO-BREAK SPACE, toggled at the end of a repeated message so the region still changes. */
const NBSP = ' '

let message = $state('')

/** The live region's current text. Reactive. */
export function currentAnnouncement(): string {
  return message
}

/** Speaks `text` politely. Repeating the same text still announces it. Blank text is ignored. */
export function announce(text: string): void {
  const trimmed = text.trim()
  if (trimmed === '') return
  message = message === trimmed ? trimmed + NBSP : trimmed
}
