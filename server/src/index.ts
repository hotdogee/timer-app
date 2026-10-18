/**
 * The Worker: serves the web app (static assets from ../dist) and the API at one origin.
 *
 * Routes (only `/api/*` and `/__dev/*` run the Worker in production, see wrangler.jsonc):
 * - `/api/auth/*`: Better Auth.
 * - `GET /api/time`: the server clock, for the client's clock-skew correction.
 * - `GET /api/config`: the configured OAuth providers and the server mode.
 * - `GET /api/sync` (WebSocket): the signed-in user's TinyBase sync socket, relayed to their
 *   Durable Object; without a session, a socket that closes at once with 4401.
 * - `GET /api/export`: the user's synced data as the server holds it.
 * - `GET /__dev/otp?email=`: development only, the last sign-in code sent to an address.
 * Any other `/api/*` or `/__dev/*` path is a JSON 404; everything else goes to the assets.
 *
 * `/api/*` answers the desktop app's origins across origins (`cors.ts`): CORS headers on its
 * responses, and 204 for preflights.
 */
import { authenticate, createAuth } from './auth'
import { appEnv, isDevelopment } from './config'
import { isPreflight, preflight, withCors } from './cors'
import { apiError, isWebSocketUpgrade, json, methodNotAllowed, withApiHeaders } from './http'
import { lastDevCode } from './mail'
import {
  API_PATHS,
  SERVER_COPY_FILE_PREFIX,
  SERVER_EXPORT_FORMAT,
  SYNC_CLOSE_REASONS,
  SYNC_CLOSE_UNAUTHORIZED,
  SYNC_SUBPROTOCOL,
  type ConfigResponse,
  type DevOtpResponse,
  type ServerExport,
  type TimeResponse,
} from './protocol'
import {
  SESSION_EXPIRES_HEADER,
  SESSION_ID_HEADER,
  syncObjectPath,
  userSyncStub,
} from './sync-object'

export { SyncObject } from './sync-object'

/** Whether `path` is `prefix` itself or below it. */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function time(): Response {
  const body: TimeResponse = { now: Date.now() }
  return json(body)
}

async function config(env: Env): Promise<Response> {
  const { providers } = await createAuth(env)
  const body: ConfigResponse = { providers, appEnv: appEnv(env) }
  return json(body)
}

/** The subprotocols a WebSocket request offers (`Sec-WebSocket-Protocol`, comma-separated). */
function offeredSubprotocols(request: Request): string[] {
  const header = request.headers.get('Sec-WebSocket-Protocol')
  if (!header) return []
  return header
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

/** The 101 answer for the client's end of a socket, naming `timer-sync` when it offered any. */
function upgraded(socket: WebSocket, offered: readonly string[]): Response {
  const headers = new Headers()
  if (offered.length > 0) headers.set('Sec-WebSocket-Protocol', SYNC_SUBPROTOCOL)
  return new Response(null, { status: 101, webSocket: socket, headers })
}

/**
 * A socket that closes at once with {@link SYNC_CLOSE_UNAUTHORIZED}: the answer to an upgrade
 * without a valid session. Browsers report a refused handshake (HTTP 401) only as a failed
 * connection, which looks like a network error; this close code tells the app to check its
 * session instead of retrying.
 */
function refuseSocket(offered: readonly string[]): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
  server.accept()
  server.close(SYNC_CLOSE_UNAUTHORIZED, SYNC_CLOSE_REASONS.unauthorized)
  return upgraded(client, offered)
}

/**
 * The sync socket. Checks, in order: an upgrade (else 426), the `timer-sync` subprotocol when any
 * is offered (else 400), a session (else a socket that closes with 4401). The request then goes
 * to the user's object without credentials, on the path `/user/<id>`, with the session's id and
 * expiry for the object to keep on the socket; the answer names `timer-sync` as the chosen
 * subprotocol (never the token entry) whenever the client offered subprotocols.
 */
async function sync(request: Request, env: Env): Promise<Response> {
  if (!isWebSocketUpgrade(request)) {
    return apiError(426, 'upgrade-required', { Upgrade: 'websocket' })
  }
  const offered = offeredSubprotocols(request)
  if (offered.length > 0 && !offered.includes(SYNC_SUBPROTOCOL)) {
    return apiError(400, 'bad-request')
  }
  const session = await authenticate(request, env)
  if (!session) return refuseSocket(offered)

  const userId = session.user.id
  const target = new URL(request.url)
  target.pathname = syncObjectPath(userId)
  target.search = ''
  const headers = new Headers(request.headers)
  for (const name of ['Cookie', 'Authorization', 'Sec-WebSocket-Protocol']) headers.delete(name)
  // Set here, so a client cannot choose them.
  headers.set(SESSION_ID_HEADER, session.session.id)
  headers.set(SESSION_EXPIRES_HEADER, String(new Date(session.session.expiresAt).getTime()))
  const upstream = await userSyncStub(env, userId).fetch(target, { method: 'GET', headers })
  const socket = upstream.webSocket
  if (upstream.status !== 101 || !socket) return upstream
  return upgraded(socket, offered)
}

/** The date part of a timestamp, for the download's file name. */
function day(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

async function exportData(request: Request, env: Env): Promise<Response> {
  const session = await authenticate(request, env)
  if (!session) return apiError(401, 'unauthorized')
  const { tables, values } = await userSyncStub(env, session.user.id).exportContent()
  const exportedAt = Date.now()
  const body: ServerExport = {
    app: 'timer-app',
    kind: 'server-copy',
    format: SERVER_EXPORT_FORMAT,
    exportedAt,
    tables,
    values,
  }
  return json(body, 200, {
    'Content-Disposition': `attachment; filename="${SERVER_COPY_FILE_PREFIX}-${day(exportedAt)}.json"`,
  })
}

function devOtp(url: URL): Response {
  const email = url.searchParams.get('email')?.trim()
  if (!email) return apiError(400, 'bad-request')
  const otp = lastDevCode(email)
  if (otp === undefined) return apiError(404, 'not-found')
  const body: DevOtpResponse = { otp }
  return json(body)
}

/** Routes one request (see the module comment). */
export async function route(request: Request, env: Env): Promise<Response> {
  if (!under(new URL(request.url).pathname, '/api')) return serve(request, env)
  if (isPreflight(request)) return preflight(request, env)
  return withCors(request, env, await serve(request, env))
}

/** Serves one request, CORS aside. */
async function serve(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (under(path, API_PATHS.auth)) {
    const { auth } = await createAuth(env)
    return withApiHeaders(await auth.handler(request))
  }

  const get = request.method === 'GET'
  switch (path) {
    case API_PATHS.time:
      return get ? time() : methodNotAllowed('GET')
    case API_PATHS.config:
      return get ? config(env) : methodNotAllowed('GET')
    case API_PATHS.sync:
      return get ? sync(request, env) : methodNotAllowed('GET')
    case API_PATHS.export:
      return get ? exportData(request, env) : methodNotAllowed('GET')
    case API_PATHS.devOtp:
      // Outside development the endpoint does not exist, whatever the method.
      if (!isDevelopment(env)) return apiError(404, 'not-found')
      return get ? devOtp(url) : methodNotAllowed('GET')
  }

  if (under(path, '/api') || under(path, '/__dev')) return apiError(404, 'not-found')
  return env.ASSETS.fetch(request)
}

export default {
  fetch: (request, env) => route(request, env),
} satisfies ExportedHandler<Env>
