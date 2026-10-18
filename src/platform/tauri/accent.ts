/** The OS accent color through the shell (`src-tauri/src/accent.rs`). */
import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { onEvent } from './events'

/** Sent to every window when the OS accent color changes (Windows). Payload: `#rrggbb`. */
export const ACCENT_CHANGED = 'accent-changed'

/** A `#rrggbb` color from the shell, lowercase, or null for anything else. */
export function accentFrom(value: unknown): string | null {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null
}

/** Command `accent_color`: the OS accent color as `#rrggbb`, or null when the OS has none. */
export async function accentColor(): Promise<string | null> {
  return accentFrom(await invoke<unknown>('accent_color'))
}

/** Calls `listener` with each new accent color; payloads that are not colors are ignored. */
export function onAccentChanged(listener: (accent: string) => void): Promise<UnlistenFn> {
  return onEvent(ACCENT_CHANGED, (payload) => {
    const accent = accentFrom(payload)
    if (accent !== null) listener(accent)
  })
}
