import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import ConfirmDialog from './ConfirmDialog.svelte'

// jsdom has <dialog> but not its modal methods: a minimal stand-in that, like the browser,
// closes synchronously and fires `close` afterwards.
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

function open() {
  const target = document.createElement('div')
  document.body.append(target)
  const onconfirm = vi.fn()
  const oncancel = vi.fn()
  const app = mount(ConfirmDialog, {
    target,
    props: {
      open: true,
      title: 'Delete Tea?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      onconfirm,
      oncancel,
    },
  })
  mounted.push(() => {
    void unmount(app)
    target.remove()
  })
  flushSync()
  const dialog = target.querySelector('dialog')
  if (dialog === null) throw new Error('no dialog')
  const button = (name: string): HTMLButtonElement => {
    const found = [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
    if (found === undefined) throw new Error(`no ${name} button`)
    return found
  }
  /** Lets the dialog's `close` event arrive. */
  const closed = () => new Promise((resolve) => setTimeout(resolve, 0))
  return { dialog, button, onconfirm, oncancel, closed }
}

function enter(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('ConfirmDialog', () => {
  it('opens modal as an alert dialog named by its question, Delete focused first', () => {
    const { dialog, button } = open()
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    const heading = dialog.querySelector('h2')
    expect(heading?.textContent).toBe('Delete Tea?')
    expect(dialog.getAttribute('aria-labelledby')).toBe(heading?.id)
    expect(button('Delete').hasAttribute('autofocus')).toBe(true)
    expect(button('Cancel').hasAttribute('autofocus')).toBe(false)
  })

  it('confirms with the confirming button, after closing', async () => {
    const { dialog, button, onconfirm, oncancel, closed } = open()
    button('Delete').click()
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(onconfirm).not.toHaveBeenCalled()
    await closed()
    expect(onconfirm).toHaveBeenCalledTimes(1)
    expect(oncancel).not.toHaveBeenCalled()
  })

  it('cancels with Cancel, or when the dialog closes any other way (Esc)', async () => {
    const first = open()
    first.button('Cancel').click()
    await first.closed()
    expect(first.oncancel).toHaveBeenCalledTimes(1)
    expect(first.onconfirm).not.toHaveBeenCalled()

    const second = open()
    second.dialog.close() // what Esc does
    await second.closed()
    expect(second.oncancel).toHaveBeenCalledTimes(1)
    expect(second.onconfirm).not.toHaveBeenCalled()
  })

  it('confirms with Enter anywhere but on a button, which acts on its own', async () => {
    const { dialog, button, onconfirm, closed } = open()
    expect(enter(button('Cancel')).defaultPrevented).toBe(false)
    expect(dialog.hasAttribute('open')).toBe(true)
    const event = enter(dialog.querySelector('h2') ?? dialog)
    expect(event.defaultPrevented).toBe(true)
    await closed()
    expect(onconfirm).toHaveBeenCalledTimes(1)
  })
})
