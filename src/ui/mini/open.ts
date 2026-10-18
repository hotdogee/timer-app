/**
 * Opening the mini window on a card (the card header's button, the `T` shortcut, the palette's
 * command): through the platform's mini window, which floats above other apps as Settings ›
 * Desktop says. The web draws the card into its Picture-in-Picture window with
 * {@link renderMiniCard}, loaded first so its styles are in the page to copy; the desktop
 * window draws its own page.
 */
import { platform, type MiniWindowController } from '../../platform'
import { settingsStore } from '../../state/settings.svelte'

/** What {@link openMiniWindow} uses; the app's by default. */
export interface OpenMiniOptions {
  readonly windows?: MiniWindowController
  /** Whether the window floats above other apps (Settings › Desktop). */
  readonly alwaysOnTop?: () => boolean
}

/**
 * Opens the mini window on card `cardId`, or switches the open one to it. Call it from a user
 * gesture (Picture-in-Picture needs one). Does nothing where there is no mini window. Never
 * rejects.
 */
export async function openMiniWindow(cardId: string, options: OpenMiniOptions = {}): Promise<void> {
  const windows = options.windows ?? platform.windows
  if (!windows.supported) return
  const alwaysOnTop = (options.alwaysOnTop ?? (() => settingsStore.desktop.miniAlwaysOnTop))()
  try {
    const { renderMiniCard } = await import('./render')
    await windows.open(cardId, renderMiniCard, { alwaysOnTop })
  } catch (error) {
    // Only the render module can fail to load (a lost connection to a new build).
    console.warn('Timer App: could not load the mini window', error)
  }
}
