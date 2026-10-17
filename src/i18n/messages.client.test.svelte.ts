import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'

import { stopwatch } from '../core'
import LapList from '../ui/card/LapList.svelte'
import { localeState, setAppLocale } from './locale.svelte'
import { m } from './messages.svelte'

afterEach(() => {
  setAppLocale('en')
})

describe('setAppLocale in the browser', () => {
  it('sets <html lang> to the active locale', () => {
    setAppLocale('ja')
    expect(document.documentElement.lang).toBe('ja')
    setAppLocale('zh-TW')
    expect(document.documentElement.lang).toBe('zh-TW')
    setAppLocale('en')
    expect(document.documentElement.lang).toBe('en')
  })
})

describe('reactive messages', () => {
  it('re-run an effect that shows a message when the locale changes, and only then', () => {
    const seen: string[] = []
    const stop = $effect.root(() => {
      $effect(() => {
        seen.push(m.card_times_up())
      })
    })
    flushSync()
    expect(seen).toEqual(["Time's up"])
    setAppLocale('ja')
    flushSync()
    expect(seen).toEqual(["Time's up", '時間です'])
    setAppLocale('ja')
    flushSync()
    expect(seen).toHaveLength(2) // the same locale again changes nothing
    setAppLocale('zh-TW')
    flushSync()
    expect(seen).toEqual(["Time's up", '時間です', '時間到'])
    stop()
  })

  it('update a $derived built from messages', () => {
    let read = (): string => ''
    const stop = $effect.root(() => {
      const label = $derived(m.card_delete({ name: 'Tea' }))
      read = () => label
    })
    expect(read()).toBe('Delete Tea')
    setAppLocale('ja')
    expect(read()).toBe('「Tea」を削除')
    stop()
  })

  it('re-render a mounted component in place, without remounting it', () => {
    const target = document.createElement('div')
    document.body.append(target)
    const state = stopwatch.lap(stopwatch.start(stopwatch.createStopwatch(), 0), 1_000)
    const app = mount(LapList, { target, props: { state, now: 2_000, total: '2.00', name: 'Run' } })
    flushSync()
    const region = target.querySelector('[role="region"]')
    const headers = () => [...target.querySelectorAll('th')].map((th) => th.textContent)
    expect(headers()).toEqual(['Lap', 'Lap time', 'Total'])
    expect(region?.getAttribute('aria-label')).toBe('Laps, Run')

    setAppLocale('ja')
    flushSync()
    expect(localeState.current).toBe('ja')
    expect(headers()).toEqual(['ラップ', 'ラップタイム', '合計'])
    expect(region?.getAttribute('aria-label')).toBe('「Run」のラップ')
    // The same element, updated rather than replaced.
    expect(target.querySelector('[role="region"]')).toBe(region)

    setAppLocale('zh-TW')
    flushSync()
    expect(headers()).toEqual(['圈數', '單圈時間', '總時間'])
    void unmount(app)
    target.remove()
  })
})
