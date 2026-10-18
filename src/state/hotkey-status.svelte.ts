/**
 * What binding each global hotkey last came to (desktop). The launch registration
 * (`startDesktop`) and Settings › Desktop write it through {@link bindHotkey}, and the section
 * shows a problem as soon as it opens: a combo that another app took before this one started would
 * look bound otherwise, and do nothing.
 */
import type { GlobalHotkeys, HotkeyId, HotkeyResult } from '../platform'

/** One hotkey's last registration: the combo (portable binding text) and what binding it came to. */
export interface HotkeyStatus {
  readonly combo: string
  readonly result: HotkeyResult
}

/** Each hotkey's last registration; null when it is unbound (or was never bound this session). */
export const hotkeyStatus: Record<HotkeyId, HotkeyStatus | null> = $state({
  toggleLast: null,
  showApp: null,
})

/**
 * Binds hotkey `id` to `combo` (null releases it) and records what that came to in
 * {@link hotkeyStatus}. Resolves to the result; never rejects.
 */
export async function bindHotkey(
  hotkeys: Pick<GlobalHotkeys, 'set'>,
  id: HotkeyId,
  combo: string | null,
): Promise<HotkeyResult> {
  const result = await hotkeys.set(id, combo)
  hotkeyStatus[id] = combo === null ? null : { combo, result }
  return result
}
