/** The scripted smoke test's hook (`src-tauri/src/smoke.rs`, debug builds only). */
import { invoke } from '@tauri-apps/api/core'

/** Command `smoke_mark`: prints `[smoke] <time> <message>` on the shell's stdout. */
export function smokeMark(message: string): Promise<void> {
  return invoke('smoke_mark', { message })
}
