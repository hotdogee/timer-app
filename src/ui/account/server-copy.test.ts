import { describe, expect, it, vi } from 'vitest'

import type { ServerExport } from '../../sync/protocol'
import type { DownloadEnvironment } from '../settings/data-file'
import { ServerCopyError, downloadServerCopy, serverCopyFileName } from './server-copy'

const EXPORTED_AT = Date.UTC(2026, 9, 18, 12, 0, 0)

const COPY: ServerExport = {
  app: 'timer-app',
  kind: 'server-copy',
  format: 1,
  exportedAt: EXPORTED_AT,
  tables: { cards: { c1: { name: 'Tea' } } },
  values: {},
}

function environment() {
  const links: { href: string; download: string; clicked: boolean }[] = []
  const blobs: Blob[] = []
  const revoked: string[] = []
  const later: (() => void)[] = []
  const env: DownloadEnvironment = {
    document: {
      createElement: (() => {
        const link = {
          href: '',
          download: '',
          hidden: false,
          clicked: false,
          click() {
            link.clicked = true
          },
          remove() {
            // Gone from the page.
          },
        }
        links.push(link)
        return link
      }) as unknown as Document['createElement'],
      body: { append: () => undefined } as unknown as HTMLElement,
    },
    createObjectURL: (blob) => {
      blobs.push(blob)
      return `blob:${String(blobs.length)}`
    },
    revokeObjectURL: (url) => {
      revoked.push(url)
    },
    later: (run) => {
      later.push(run)
    },
  }
  return { env, links, blobs, revoked, later }
}

function respond(body: unknown, init: ResponseInit = { status: 200 }) {
  return vi.fn(() =>
    Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

describe('serverCopyFileName', () => {
  it('dates the file like the app’s own export, marked as the server’s', () => {
    expect(serverCopyFileName(EXPORTED_AT)).toMatch(/^timer-app-server-copy-2026-10-1[789]\.json$/)
  })
})

describe('downloadServerCopy', () => {
  it('fetches the export with the session and saves it as a JSON download', async () => {
    const fetch = respond(COPY)
    const { env, links, blobs, revoked, later } = environment()
    const name = await downloadServerCopy({ url: '/api/export', fetch, environment: env })
    expect(name).toBe(serverCopyFileName(EXPORTED_AT))
    expect(fetch).toHaveBeenCalledWith(
      '/api/export',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    )
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ href: 'blob:1', download: name, clicked: true })
    const [blob] = blobs
    if (blob === undefined) throw new Error('Nothing was saved')
    expect(JSON.parse(await blob.text())).toEqual(COPY)
    expect(blob.type).toBe('application/json')
    for (const run of later) run()
    expect(revoked).toEqual(['blob:1'])
  })

  it('rejects with the status when the server refuses (signed out)', async () => {
    const { env, links } = environment()
    const result = downloadServerCopy({
      fetch: respond({ error: 'unauthorized' }, { status: 401 }),
      environment: env,
    })
    await expect(result).rejects.toBeInstanceOf(ServerCopyError)
    await expect(result).rejects.toMatchObject({ status: 401 })
    expect(links).toHaveLength(0)
  })

  it('rejects an answer that is not a server copy', async () => {
    const { env } = environment()
    await expect(
      downloadServerCopy({ fetch: respond({ hello: 'world' }), environment: env }),
    ).rejects.toMatchObject({ status: 0 })
    await expect(
      downloadServerCopy({ fetch: respond('<!doctype html>'), environment: env }),
    ).rejects.toMatchObject({ status: 0 })
  })

  it('passes a network failure on as it is', async () => {
    const offline = new TypeError('Failed to fetch')
    const { env } = environment()
    await expect(
      downloadServerCopy({ fetch: () => Promise.reject(offline), environment: env }),
    ).rejects.toBe(offline)
  })
})
