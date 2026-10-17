import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Dialog from './Dialog.svelte'

// jsdom has <dialog> but not its modal methods: a stand-in that, like the browser, closes at once
// and fires `close` a task later.
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        if (!this.hasAttribute('open')) return
        this.removeAttribute('open')
        setTimeout(() => this.dispatchEvent(new Event('close')))
      },
    },
  })
})

const mounted: (() => void)[] = []
afterEach(() => {
  for (const stop of mounted.splice(0)) stop()
})

const content = createRawSnippet(() => ({ render: () => '<button>Inside</button>' }))

function show() {
  const state = $state({ open: true })
  const onclose = vi.fn()
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(Dialog, {
    target,
    props: {
      get open() {
        return state.open
      },
      set open(value: boolean) {
        state.open = value
      },
      label: 'Test',
      onclose,
      children: content,
    },
  })
  mounted.push(() => {
    void unmount(app)
    target.remove()
  })
  flushSync()
  const dialog = target.querySelector('dialog')
  if (dialog === null) throw new Error('no dialog')
  /** Lets a queued `close` event arrive. */
  const later = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { state, dialog, onclose, later }
}

describe('Dialog', () => {
  it('follows open both ways and reports each close once', async () => {
    const { state, dialog, onclose, later } = show()
    expect(dialog.open).toBe(true)
    state.open = false
    flushSync()
    expect(dialog.open).toBe(false)
    await later()
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('is closed for the app as soon as Esc asks, before the close event', () => {
    const { state, dialog } = show()
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    expect(state.open).toBe(false)
  })

  it('stays open when Esc is held back by another handler', () => {
    const { state, dialog } = show()
    const cancel = new Event('cancel', { cancelable: true })
    cancel.preventDefault()
    dialog.dispatchEvent(cancel)
    expect(state.open).toBe(true)
  })

  it('ignores a close event left over from a close it was reopened right after', async () => {
    const { state, dialog, onclose, later } = show()
    // Closed (as a close button does) and reopened before the queued close event arrives.
    dialog.close()
    state.open = false
    flushSync()
    state.open = true
    flushSync()
    expect(dialog.open).toBe(true)
    await later()
    expect(state.open).toBe(true)
    expect(dialog.open).toBe(true)
    expect(onclose).not.toHaveBeenCalled()
  })

  it('closes on a press that starts and ends on the backdrop, at once', () => {
    const { state, dialog } = show()
    dialog.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(dialog.open).toBe(false)
    expect(state.open).toBe(false)
  })
})
