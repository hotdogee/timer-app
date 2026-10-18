/** The action bar's sync status button, in jsdom with Svelte's browser runtime. */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setAppLocale } from '../../i18n'
import { iconPath } from '../primitives/icons'
import SyncStatusButton from './SyncStatusButton.svelte'
import type { SyncStatus } from './types'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  setAppLocale('en')
})

function setup(status: SyncStatus) {
  const state = $state({ status })
  const onclick = vi.fn()
  const target = document.createElement('div')
  document.body.append(target)
  const button = mount(SyncStatusButton, {
    target,
    props: {
      get status() {
        return state.status
      },
      onclick,
    },
  })
  cleanups.push(() => {
    void unmount(button)
    target.remove()
  })
  flushSync()
  const element = target.querySelector('button')
  if (element === null) throw new Error('No button')
  return { state, onclick, element }
}

describe('SyncStatusButton', () => {
  it('names the status and opens the account', () => {
    const { element, onclick } = setup('online')
    expect(element.getAttribute('aria-label')).toBe('Account: Synced')
    expect(element.title).toBe('Account: Synced')
    expect(element.type).toBe('button')
    element.click()
    expect(onclick).toHaveBeenCalledTimes(1)
  })

  it('follows the status with its name and its cloud', () => {
    const { state, element } = setup('online')
    const path = () => element.querySelector('path')?.getAttribute('d')
    expect(path()).toBe(iconPath('cloud_done'))
    state.status = 'connecting'
    flushSync()
    expect(element.getAttribute('aria-label')).toBe('Account: Connecting…')
    expect(path()).toBe(iconPath('cloud_sync'))
    state.status = 'offline'
    flushSync()
    expect(element.getAttribute('aria-label')).toBe('Account: Offline')
    expect(path()).toBe(iconPath('cloud_off'))
    expect(element.dataset.syncStatus).toBe('offline')
  })

  it('speaks the active language', () => {
    setAppLocale('zh-TW')
    const { element } = setup('offline')
    expect(element.getAttribute('aria-label')).toBe('帳號：離線')
  })
})
