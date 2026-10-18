/**
 * Listening to the desktop shell's events from this webview. An event the shell sends to one
 * window (`emit_to`) also reaches every listener that listens to all targets, in any window, so a
 * listener for such an event listens to this window only.
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** The label of the window this page runs in: `main`, or `mini` for the mini window. */
export function windowLabel(): string {
  return getCurrentWindow().label
}

/** Listens to `event` wherever it is sent (`app.emit`), with its payload. */
export function onEvent(event: string, handler: (payload: unknown) => void): Promise<UnlistenFn> {
  return listen<unknown>(event, ({ payload }) => {
    handler(payload)
  })
}

/** Listens to `event` when it is sent to this window (`emit_to`) or to every window. */
export function onWindowEvent(
  event: string,
  handler: (payload: unknown) => void,
): Promise<UnlistenFn> {
  return listen<unknown>(
    event,
    ({ payload }) => {
      handler(payload)
    },
    { target: { kind: 'WebviewWindow', label: windowLabel() } },
  )
}
