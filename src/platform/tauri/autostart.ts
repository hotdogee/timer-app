/**
 * Launch at login through the autostart plugin (the shell starts the app with `--minimized`), with
 * the shell's `quote_launch_entry` after turning it on: the plugin writes the Windows Run entry
 * without quotes, which a path with spaces needs (`src-tauri/src/autostart.rs`).
 */
import { invoke } from '@tauri-apps/api/core'
import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart'

export { isEnabled }

/** Turns launch at login on or off and resolves to the state the OS reports afterwards. */
export async function setEnabled(enabled: boolean): Promise<boolean> {
  if (enabled) {
    await enable()
    // Best effort: an unquoted entry still starts the app where its path has no spaces.
    await invoke('quote_launch_entry').catch((error: unknown) => {
      console.warn('Timer App: could not quote the launch-at-login entry', error)
    })
  } else {
    await disable()
  }
  return isEnabled()
}
