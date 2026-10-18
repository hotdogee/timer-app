/**
 * Settings › Account › Download server copy: fetches the signed-in user's synced data as the
 * server stores it (`GET /api/export`, a `ServerExport`) and saves it as
 * `timer-app-server-copy-YYYY-MM-DD.json` (the name the server gives the download too), for the
 * data-export obligation (spec › Sync › Obligations). The app's own export (Settings › Data) is
 * the local copy; this one shows what the server holds.
 */
import { exportFormat } from '../../core'
import { apiUrl } from '../../sync/api'
import { API_PATHS, SERVER_COPY_FILE_PREFIX, type ServerExport } from '../../sync/protocol'
import { saveFile, type DownloadEnvironment } from '../settings/data-file'

/** What the download needs: the request, and the page to save a file through. */
export interface ServerCopyOptions {
  /** The export endpoint's URL; `/api/export` on the API origin by default. */
  readonly url?: string
  /** `fetch` (tests). */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
  /**
   * The desktop app's bearer token, sent instead of the session cookie (the API is on another
   * origin there); null on the web.
   */
  readonly token?: string | null
  readonly environment?: DownloadEnvironment
}

/** Why the download failed: the server said no (signed out, an error), or it was not reached. */
export class ServerCopyError extends Error {
  /** The HTTP status, or 0 when the server was not reached or sent something else. */
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ServerCopyError'
    this.status = status
  }
}

function isServerExport(value: unknown): value is ServerExport {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.app === 'timer-app' &&
    record.kind === 'server-copy' &&
    typeof record.exportedAt === 'number' &&
    typeof record.tables === 'object' &&
    record.tables !== null
  )
}

/** The file name of a server copy made at `exportedAt`: `timer-app-server-copy-2026-10-18.json`. */
export function serverCopyFileName(exportedAt: number): string {
  return exportFormat.exportFileName(exportedAt).replace(/^timer-app/, SERVER_COPY_FILE_PREFIX)
}

/**
 * Downloads the server copy and saves it. Resolves to the file name; rejects with a
 * {@link ServerCopyError} when the server refuses (401 when signed out) or answers with something
 * that is not a server copy, and with `fetch`'s own error when offline.
 */
export async function downloadServerCopy(options: ServerCopyOptions = {}): Promise<string> {
  const request = options.fetch ?? ((url, init) => fetch(url, init))
  const token = options.token ?? null
  const response = await request(options.url ?? apiUrl(API_PATHS.export), {
    credentials: token === null ? 'include' : 'omit',
    cache: 'no-store',
    headers:
      token === null
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new ServerCopyError(response.status, response.statusText)
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ServerCopyError(0, 'not json')
  }
  if (!isServerExport(body)) throw new ServerCopyError(0, 'not a server copy')
  const name = serverCopyFileName(body.exportedAt)
  saveFile(name, `${JSON.stringify(body, null, 2)}\n`, options.environment)
  return name
}
