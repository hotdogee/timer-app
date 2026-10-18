/**
 * Where the sync server is. On the web the Worker serves the app and the API from one origin (and
 * in development Vite proxies `/api` to `wrangler dev`), so requests go to the page's own origin:
 * no CORS, and the session cookie is first-party. A build for another host (the desktop app, M5)
 * sets `VITE_API_ORIGIN`, e.g. `https://timer.example.com`.
 */

/** The page's location, as far as URLs need it. */
export interface PageLocation {
  readonly protocol: string
  readonly host: string
}

/**
 * The API's origin without a trailing slash, from `VITE_API_ORIGIN`, or `''` for the page's own
 * origin (the web).
 */
export function apiOrigin(): string {
  const configured: unknown = import.meta.env.VITE_API_ORIGIN
  return typeof configured === 'string' ? configured.trim().replace(/\/+$/, '') : ''
}

/**
 * The URL of an API path (`API_PATHS.time` → `/api/time`): relative on the web, absolute when the
 * API lives elsewhere.
 */
export function apiUrl(path: string, origin: string = apiOrigin()): string {
  return origin + path
}

/**
 * The WebSocket URL of an API path, always absolute (`new WebSocket` needs a `ws:` or `wss:` URL in
 * older engines): the API origin with `http` turned into `ws`, or the page's own host, `wss:` when
 * the page is served over HTTPS.
 */
export function wsUrl(
  path: string,
  origin: string = apiOrigin(),
  page: PageLocation | undefined = globalThis.location,
): string {
  if (origin !== '') {
    return (
      origin.replace(/^http(s?):/i, (_scheme, secure: string) => (secure ? 'wss:' : 'ws:')) + path
    )
  }
  if (!page) throw new Error('Timer App: no API origin and no page location for ' + path)
  return `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}${path}`
}
