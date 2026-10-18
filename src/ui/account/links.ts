/**
 * Links to other sites (the privacy policy, the source code) in the desktop app: a
 * `target="_blank"` link would open inside the app's own webview, so there a click opens the page
 * in the system browser through the platform's opener instead. On the web the link works as usual.
 */
import { platform } from '../../platform'

/**
 * A click handler for a link to `url`: on desktop it opens `url` with `open` (the platform's
 * opener by default) instead of following the link; on the web it does nothing.
 */
export function externalLinkClick(
  url: string,
  desktop: boolean,
  open: (url: string) => Promise<unknown> = (target) => platform.opener.open(target),
): (event: MouseEvent) => void {
  return (event) => {
    if (!desktop) return
    event.preventDefault()
    void open(url)
  }
}
