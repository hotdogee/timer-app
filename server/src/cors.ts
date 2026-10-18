/**
 * Cross-origin access to the API for the desktop app (spec › Sync › Desktop sign-in). The web app
 * calls the API from its own origin and needs none of this. The desktop app's webview has an
 * origin of its own and calls the API across origins with a bearer token: `http://tauri.localhost`
 * on Windows (`https://tauri.localhost` with Tauri's `useHttpsScheme`), `tauri://localhost` on
 * macOS and Linux, and under `tauri dev` the Vite dev server's origin, which is trusted already as
 * `BETTER_AUTH_URL` or through `TRUSTED_ORIGINS`.
 *
 * For a request from one of those origins (exactly; an `Origin` header is already normalized),
 * API responses get `Access-Control-Allow-Origin` naming it, and preflights (`OPTIONS`) answer
 * 204. There is no `Access-Control-Allow-Credentials`: the desktop app sends no cookies, so a page
 * on one of these origins can never use a browser session. Any other origin gets no CORS headers,
 * so the browser keeps the responses from it. Every API response varies on `Origin`.
 * WebSocket upgrades are not subject to CORS; `authenticate` handles their `Origin`.
 */
import { trustedOrigins } from './config'

/** The desktop app's webview origins, on every OS. */
export const DESKTOP_ORIGINS: readonly string[] = Object.freeze([
  'http://tauri.localhost',
  'https://tauri.localhost',
  'tauri://localhost',
])

/** The request headers the desktop app sends: its bearer token and JSON bodies. */
export const CORS_ALLOW_HEADERS = 'Authorization, Content-Type'

/** The methods the API serves. */
export const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS'

/** How long a browser may cache a preflight's answer, in seconds. */
export const CORS_MAX_AGE_SECONDS = 600

const originsByEnv = new WeakMap<Env, readonly string[]>()

/**
 * The origins that may call the API across origins: {@link DESKTOP_ORIGINS}, `BETTER_AUTH_URL`'s
 * and every valid `TRUSTED_ORIGINS` entry. Read once per `env` (in practice once per isolate).
 */
export function corsOrigins(env: Env): readonly string[] {
  let origins = originsByEnv.get(env)
  if (origins === undefined) {
    origins = Object.freeze([...new Set([...DESKTOP_ORIGINS, ...trustedOrigins(env)])])
    originsByEnv.set(env, origins)
  }
  return origins
}

/** The request's `Origin` when it may call the API across origins, else null. */
export function allowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get('Origin')
  return origin !== null && corsOrigins(env).includes(origin) ? origin : null
}

/** Whether `request` is a CORS preflight: `OPTIONS` with `Origin` and the method it asks for. */
export function isPreflight(request: Request): boolean {
  return (
    request.method === 'OPTIONS' &&
    request.headers.has('Origin') &&
    request.headers.has('Access-Control-Request-Method')
  )
}

/** Sets the CORS headers for `origin` on `headers`, and adds `Origin` to `Vary`. */
function setCorsHeaders(headers: Headers, origin: string | null): void {
  const vary = headers.get('Vary')
  const varies = vary?.split(',').some((name) => name.trim().toLowerCase() === 'origin') ?? false
  if (!varies) headers.append('Vary', 'Origin')
  if (origin === null) return
  headers.set('Access-Control-Allow-Origin', origin)
  headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS)
  headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS)
  headers.set('Access-Control-Max-Age', String(CORS_MAX_AGE_SECONDS))
}

/** The answer to a preflight: 204, with the CORS headers when its origin is allowed. */
export function preflight(request: Request, env: Env): Response {
  const headers = new Headers()
  setCorsHeaders(headers, allowedOrigin(request, env))
  return new Response(null, { status: 204, headers })
}

/**
 * `response` to an API request, with the CORS headers when the request's origin is allowed, on a
 * copy (headers of fetched responses are immutable). Upgrade responses (101) are returned as
 * they are.
 */
export function withCors(request: Request, env: Env, response: Response): Response {
  if (response.status === 101) return response
  const copy = new Response(response.body, response)
  setCorsHeaders(copy.headers, allowedOrigin(request, env))
  return copy
}
