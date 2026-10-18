/**
 * Bringing the main window back from the tray, or sending it there, as the `showApp` hotkey and a
 * click on a notification do. It acts on the window this page runs in, the main window: only it
 * registers hotkeys and shows notifications.
 */
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Shows the window, restores it when minimized and gives it the focus. Restoring and focusing are
 * best effort: a window that cannot be restored or focused is still better shown than not.
 */
export async function showWindow(): Promise<void> {
  const window = getCurrentWindow()
  await window.unminimize().catch(() => undefined)
  await window.show()
  await window.setFocus().catch(() => undefined)
}

/** Hides the window when it is on screen with the focus; otherwise shows and focuses it. */
export async function toggleWindow(): Promise<void> {
  const window = getCurrentWindow()
  const [visible, focused, minimized] = await Promise.all([
    window.isVisible(),
    window.isFocused(),
    window.isMinimized(),
  ])
  if (visible && focused && !minimized) await window.hide()
  else await showWindow()
}
