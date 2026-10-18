/**
 * Settings › Data's files (spec › Settings): reading a picked import file into export data, the
 * message for each way that fails, and saving an export as a download. The file format itself is
 * `core/export.ts`; replacing the app's data with an import is `app-data`'s `replaceAll`.
 */
import { exportFormat } from '../../core'
import { m } from '../../i18n'
import { importErrorMessage } from '../../i18n/labels'

/** Why an import failed: a reason from `parseExport`, or `'read'` when the file could not be read. */
export type ImportFailure = exportFormat.ExportErrorReason | 'read'

export type ImportFileResult =
  | { readonly ok: true; readonly data: exportFormat.ExportData }
  | { readonly ok: false; readonly reason: ImportFailure }

/**
 * The largest file worth reading, in bytes: UTF-8 takes at most 3 bytes per UTF-16 code unit (and
 * 3 more for a byte order mark), so a bigger file decodes to more than `MAX_EXPORT_LENGTH`
 * characters and `parseExport` would refuse it anyway.
 */
export const MAX_IMPORT_BYTES = exportFormat.MAX_EXPORT_LENGTH * 3 + 3

/** The part of a `File` (or `Blob`) the import reads. */
export interface ImportSource {
  readonly size: number
  text(): Promise<string>
}

/**
 * Reads and validates an export file. Never rejects: a file too large to be an export is refused
 * without reading it, a file that cannot be read gives `'read'`, and the rest is `parseExport`'s
 * verdict. The cards come back as stored, not settled.
 */
export async function readImportFile(file: ImportSource): Promise<ImportFileResult> {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, reason: 'too-large' }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, reason: 'read' }
  }
  const result = exportFormat.parseExport(text)
  return result.ok ? { ok: true, data: result.data } : { ok: false, reason: result.reason }
}

/** Why an import failed, in the active locale. */
export function importFailureMessage(reason: ImportFailure): string {
  return reason === 'read' ? m.data_import_error_read() : importErrorMessage(reason)
}

/** The parts of `document` and `URL` a download uses. */
export interface DownloadEnvironment {
  readonly document: Pick<Document, 'createElement' | 'body'>
  readonly createObjectURL: (blob: Blob) => string
  readonly revokeObjectURL: (url: string) => void
  /** Schedules the URL's release once the browser has started the download. */
  readonly later: (run: () => void) => void
}

/** How long a download's object URL is kept, so slow browsers can still read it. */
const REVOKE_AFTER_MS = 10_000

function browserEnvironment(): DownloadEnvironment {
  return {
    document,
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => {
      URL.revokeObjectURL(url)
    },
    later: (run) => {
      setTimeout(run, REVOKE_AFTER_MS)
    },
  }
}

/**
 * Saves `text` as a JSON download named `name`, through an `<a download>` link to a Blob (Settings
 * › Data's export, Settings › Account's server copy).
 */
export function saveFile(
  name: string,
  text: string,
  environment: DownloadEnvironment = browserEnvironment(),
): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = environment.createObjectURL(blob)
  const link = environment.document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  environment.document.body.append(link)
  link.click()
  link.remove()
  environment.later(() => {
    environment.revokeObjectURL(url)
  })
}

/**
 * Saves `data` as a download named `timer-app-YYYY-MM-DD.json` (the export's date in this time
 * zone). Returns the file name.
 */
export function downloadExport(
  data: exportFormat.ExportData,
  environment: DownloadEnvironment = browserEnvironment(),
): string {
  const name = exportFormat.exportFileName(data.exportedAt)
  saveFile(name, exportFormat.stringifyExport(data), environment)
  return name
}
