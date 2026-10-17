import { afterEach, describe, expect, it, vi } from 'vitest'

import { exportFormat, settings } from '../../core'
import { setAppLocale } from '../../i18n'
import {
  MAX_IMPORT_BYTES,
  downloadExport,
  importFailureMessage,
  readImportFile,
  type DownloadEnvironment,
  type ImportSource,
} from './data-file'

afterEach(() => {
  setAppLocale('en')
})

function sample(): exportFormat.ExportData {
  return exportFormat.createExport({
    exportedAt: Date.UTC(2026, 9, 18, 12),
    cards: [],
    presets: [{ id: 'tea', name: 'Tea', duration: 180_000 }],
    settings: { synced: settings.SYNCED_DEFAULTS, device: settings.DEVICE_DEFAULTS },
  })
}

describe('readImportFile', () => {
  it('reads a valid export', async () => {
    const data = sample()
    const file = new Blob([exportFormat.stringifyExport(data)], { type: 'application/json' })
    const result = await readImportFile(file)
    expect(result).toEqual({ ok: true, data })
  })

  it('reads a file that starts with a byte order mark', async () => {
    const text = exportFormat.stringifyExport(sample())
    const result = await readImportFile(new Blob(['﻿', text]))
    expect(result.ok).toBe(true)
  })

  it('gives parseExport’s reason for files that are not exports', async () => {
    expect(await readImportFile(new Blob(['{nope']))).toEqual({ ok: false, reason: 'not-json' })
    expect(await readImportFile(new Blob(['{"app":"other"}']))).toEqual({
      ok: false,
      reason: 'not-export',
    })
    const newer = { ...sample(), format: 2 }
    expect(await readImportFile(new Blob([JSON.stringify(newer)]))).toEqual({
      ok: false,
      reason: 'newer-format',
    })
  })

  it('refuses a file too large to be an export without reading it', async () => {
    const text = vi.fn(() => Promise.resolve('{}'))
    const huge: ImportSource = { size: MAX_IMPORT_BYTES + 1, text }
    expect(await readImportFile(huge)).toEqual({ ok: false, reason: 'too-large' })
    expect(text).not.toHaveBeenCalled()
    expect(MAX_IMPORT_BYTES).toBe(exportFormat.MAX_EXPORT_LENGTH * 3 + 3)
  })

  it('reports a file that cannot be read', async () => {
    const broken: ImportSource = { size: 10, text: () => Promise.reject(new Error('gone')) }
    expect(await readImportFile(broken)).toEqual({ ok: false, reason: 'read' })
  })
})

describe('importFailureMessage', () => {
  it('has a message for every reason, in the active locale', () => {
    for (const reason of [...exportFormat.EXPORT_ERROR_REASONS, 'read' as const]) {
      expect(importFailureMessage(reason)).not.toBe('')
    }
    expect(importFailureMessage('read')).toBe("The file couldn't be read.")
    expect(importFailureMessage('not-json')).toBe("The file isn't valid JSON.")
    setAppLocale('ja')
    expect(importFailureMessage('read')).toBe('ファイルを読み込めませんでした。')
  })
})

describe('downloadExport', () => {
  function fakeEnvironment() {
    const clicked: { href: string; download: string; hidden: boolean; attached: boolean }[] = []
    const appended: unknown[] = []
    const later: (() => void)[] = []
    const revoked: string[] = []
    const blobs: Blob[] = []
    const environment: DownloadEnvironment = {
      document: {
        createElement: ((tag: string) => {
          expect(tag).toBe('a')
          const link = {
            href: '',
            download: '',
            hidden: false,
            click() {
              clicked.push({
                href: link.href,
                download: link.download,
                hidden: link.hidden,
                attached: appended.includes(link),
              })
            },
            remove() {
              appended.splice(appended.indexOf(link), 1)
            },
          }
          return link
        }) as unknown as Document['createElement'],
        body: {
          append: (node: unknown) => {
            appended.push(node)
          },
        } as unknown as HTMLElement,
      },
      createObjectURL: (blob) => {
        blobs.push(blob)
        return 'blob:test'
      },
      revokeObjectURL: (url) => {
        revoked.push(url)
      },
      later: (run) => {
        later.push(run)
      },
    }
    return { environment, clicked, appended, later, revoked, blobs }
  }

  it('clicks a hidden download link to the JSON and releases it later', async () => {
    const fake = fakeEnvironment()
    const data = sample()
    const name = downloadExport(data, fake.environment)
    expect(name).toBe(exportFormat.exportFileName(data.exportedAt))
    expect(name).toMatch(/^timer-app-\d{4}-\d{2}-\d{2}\.json$/)
    expect(fake.clicked).toEqual([
      { href: 'blob:test', download: name, hidden: true, attached: true },
    ])
    expect(fake.appended).toEqual([])
    expect(fake.blobs[0]?.type).toBe('application/json')
    expect(await fake.blobs[0]?.text()).toBe(exportFormat.stringifyExport(data))
    expect(fake.revoked).toEqual([])
    for (const run of fake.later) run()
    expect(fake.revoked).toEqual(['blob:test'])
  })
})
