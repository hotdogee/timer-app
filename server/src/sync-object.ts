/**
 * One Durable Object per user holds that user's synced TinyBase store (cards, presets, behavior
 * settings) and relays changes between the user's devices over WebSockets.
 *
 * TinyBase's `WsServerDurableObject` does the protocol: each socket is accepted with the WebSocket
 * Hibernation API (idle sockets cost nothing; the object may be evicted and re-created while they
 * stay open), and the server-side `MergeableStore` is loaded from and saved to the object's SQLite
 * storage by `DurableObjectSqlStoragePersister` in JSON mode (one row; our data is far below the
 * 2 MB row limit, and it is one write per change). Nothing here holds timers or outbound sockets,
 * so hibernation stays possible.
 *
 * The Worker only forwards authenticated upgrades (`/api/sync`), to the object named after the
 * signed-in user, so a client can never reach another user's object. It tells the object which
 * session opened the socket (headers it sets itself); the object keeps that on the socket
 * (`serializeAttachment`, which survives hibernation) and closes the socket with
 * `SYNC_CLOSE_UNAUTHORIZED` when the session has expired (checked on every message) or was
 * deleted (`closeSession`, called when the user signs out or a session is revoked).
 *
 * Heartbeats (`ping` → `pong`) are answered by the runtime itself (`setWebSocketAutoResponse`),
 * so they never wake a hibernating object. The server's own requests to a client (asking for its
 * changes after it connects) wait `SYNC_REQUEST_TIMEOUT_SECONDS`, as the client's do, so a slow
 * link still uploads what a device changed while offline.
 */
import type { MergeableStore } from 'tinybase/mergeable-store'
import { createMergeableStore } from 'tinybase/mergeable-store'
import type { DurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import { WsServerDurableObject } from 'tinybase/synchronizers/synchronizer-ws-server-durable-object'

import {
  SYNC_CLOSE_REASONS,
  SYNC_CLOSE_UNAUTHORIZED,
  SYNC_PING,
  SYNC_PONG,
  SYNC_REQUEST_TIMEOUT_SECONDS,
  type ExportTables,
  type ExportValues,
} from './protocol'

/** The SQLite table that holds the store (JSON mode). */
export const STORE_TABLE = 'timer_app'

/** Close code and reason sent to every open socket when the account is deleted. */
export const WIPED_CLOSE_CODE = SYNC_CLOSE_UNAUTHORIZED
export const WIPED_CLOSE_REASON = SYNC_CLOSE_REASONS.accountDeleted

/**
 * Headers the Worker sets on a forwarded upgrade (after deleting any the client sent): the id and
 * the expiry (epoch ms) of the session that opened the socket.
 */
export const SESSION_ID_HEADER = 'X-Timer-Session-Id'
export const SESSION_EXPIRES_HEADER = 'X-Timer-Session-Expires'

/** The session a socket was opened with, kept on the socket. */
export interface SocketSession {
  readonly sessionId: string
  readonly expiresAt: number
}

/** The session the Worker named on a forwarded upgrade, or null. */
export function sessionFromHeaders(headers: Headers): SocketSession | null {
  const sessionId = headers.get(SESSION_ID_HEADER)
  const expiresAt = Number(headers.get(SESSION_EXPIRES_HEADER))
  return sessionId && Number.isFinite(expiresAt) ? { sessionId, expiresAt } : null
}

/** The session kept on `socket`, or null when it has none (or something else). */
function socketSession(socket: WebSocket): SocketSession | null {
  const value: unknown = socket.deserializeAttachment()
  if (typeof value !== 'object' || value === null) return null
  const { sessionId, expiresAt } = value as Record<string, unknown>
  return typeof sessionId === 'string' && typeof expiresAt === 'number'
    ? { sessionId, expiresAt }
    : null
}

/** Closes `socket` as no longer authorized; quietly when it is already closing. */
function closeUnauthorized(socket: WebSocket, reason: string): void {
  try {
    socket.close(SYNC_CLOSE_UNAUTHORIZED, reason)
  } catch {
    // Already closing.
  }
}

/** The object name of a user's store. Only ever derived from an authenticated user id. */
export function syncObjectName(userId: string): string {
  return `user:${userId}`
}

/** The path forwarded to the object; TinyBase uses it as the path id of the sockets. */
export function syncObjectPath(userId: string): string {
  return `/user/${encodeURIComponent(userId)}`
}

/** The stub of a user's sync object. */
export function userSyncStub(env: Env, userId: string): DurableObjectStub<SyncObject> {
  return env.SYNC.getByName(syncObjectName(userId))
}

/** The store content as `exportContent()` returns it. */
export interface StoreContent {
  readonly tables: ExportTables
  readonly values: ExportValues
}

interface Live {
  readonly store: MergeableStore
  readonly persister: DurableObjectSqlStoragePersister
}

// The base constructor calls createPersister() before this subclass's fields are initialized, so
// the live store is kept here rather than in a (private) field.
const live = new WeakMap<SyncObject, Live>()

export class SyncObject extends WsServerDurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(SYNC_PING, SYNC_PONG))
  }

  override getRequestTimeoutSeconds(): number {
    return SYNC_REQUEST_TIMEOUT_SECONDS
  }

  /** Accepts the socket (TinyBase) and keeps the session the Worker named on it. */
  override fetch(request: Request): Response | Promise<Response> {
    const session = sessionFromHeaders(request.headers)
    const response = super.fetch?.(request) ?? new Response(null, { status: 426 })
    const clientId = request.headers.get('Sec-WebSocket-Key')
    if (session && clientId) {
      // TinyBase tags each socket with its client id, the upgrade's key.
      for (const socket of this.ctx.getWebSockets(clientId)) socket.serializeAttachment(session)
    }
    return response
  }

  /** Relays a message (TinyBase), unless the socket's session has expired or is unknown. */
  override webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): void | Promise<void> {
    const session = socketSession(socket)
    if (session === null || session.expiresAt <= Date.now()) {
      closeUnauthorized(
        socket,
        session === null ? SYNC_CLOSE_REASONS.unauthorized : SYNC_CLOSE_REASONS.expired,
      )
      return
    }
    return super.webSocketMessage?.(socket, message)
  }

  /** RPC: disconnects the sockets opened with session `sessionId` (it was deleted). */
  closeSession(sessionId: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socketSession(socket)?.sessionId === sessionId) {
        closeUnauthorized(socket, SYNC_CLOSE_REASONS.signedOut)
      }
    }
  }

  override createPersister(): DurableObjectSqlStoragePersister {
    const store = createMergeableStore()
    const persister = createDurableObjectSqlStoragePersister(
      store,
      this.ctx.storage.sql,
      STORE_TABLE,
    )
    live.set(this, { store, persister })
    return persister
  }

  /**
   * RPC: the user's synced content as the server holds it (`store.getContent()`), as plain JSON
   * data (TinyBase builds prototype-less objects; RPC gets ordinary ones).
   */
  exportContent(): StoreContent {
    const [tables, values] = live.get(this)?.store.getContent() ?? [{}, {}]
    return JSON.parse(JSON.stringify({ tables, values })) as StoreContent
  }

  /**
   * RPC: deletes everything this object stores and disconnects every device; used when the
   * account is deleted. Autosave stops first, so nothing is written back afterwards, and the
   * in-memory copy is emptied as well.
   */
  async wipe(): Promise<void> {
    const state = live.get(this)
    await state?.persister.stopAutoSave()
    for (const socket of this.ctx.getWebSockets()) closeUnauthorized(socket, WIPED_CLOSE_REASON)
    state?.store.transaction(() => state.store.delTables().delValues())
    await this.ctx.storage.deleteAll()
  }
}
