import { flushSync } from 'svelte'
import type { RegisterSWOptions } from 'vite-plugin-pwa/types'
import { describe, expect, it } from 'vitest'

import { createPwa } from './pwa.svelte'

describe('pwa state in the browser runtime', () => {
  it('re-runs effects when the worker reports an update or an offline install', async () => {
    let options: RegisterSWOptions = {}
    const pwa = createPwa({
      kind: 'web',
      dev: false,
      supported: true,
      load: () =>
        Promise.resolve((registerOptions) => {
          options = registerOptions
          return () => Promise.resolve()
        }),
    })
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(
          `update=${String(pwa.state.updateReady)} offline=${String(pwa.state.offlineReady)}`,
        )
      })
    })
    flushSync()
    await pwa.register()

    options.onOfflineReady?.()
    flushSync()
    options.onNeedRefresh?.()
    flushSync()
    pwa.dismissOfflineReady()
    pwa.dismissUpdate()
    flushSync()
    stop()

    expect(seen).toEqual([
      'update=false offline=false',
      'update=false offline=true',
      'update=true offline=true',
      'update=false offline=false',
    ])
  })
})
