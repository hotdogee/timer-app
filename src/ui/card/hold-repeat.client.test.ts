import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HOLD_DELAY, HOLD_INTERVAL, holdRepeat, type HoldRepeatOptions } from './hold-repeat'

/** A button with `holdRepeat` attached, its action, and a way to detach it. */
function setup(options?: HoldRepeatOptions) {
  const button = document.createElement('button')
  // jsdom has no pointer capture.
  const capture = vi.fn()
  button.setPointerCapture = capture
  document.body.append(button)
  const action = vi.fn()
  const detach = holdRepeat(action, options)(button)
  return {
    button,
    action,
    capture,
    detach: () => {
      if (typeof detach === 'function') detach()
      button.remove()
    },
  }
}

let cleanup: (() => void)[] = []

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const detach of cleanup) detach()
  cleanup = []
  vi.useRealTimers()
})

function attached(options?: HoldRepeatOptions) {
  const parts = setup(options)
  cleanup.push(parts.detach)
  return parts
}

function pointer(target: HTMLElement, type: string, init: PointerEventInit = {}): void {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, button: 0, ...init }),
  )
}

/** A pointer click: the browser's `click` after a press, with its click count. */
function clickEvent(target: HTMLElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })
  target.dispatchEvent(event)
  return event
}

describe('holdRepeat', () => {
  it('acts once per click, with or without a press (keyboard, assistive technology)', () => {
    const { button, action } = attached()
    button.click()
    expect(action).toHaveBeenCalledTimes(1)
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY - 1)
    pointer(button, 'pointerup')
    const event = clickEvent(button)
    expect(action).toHaveBeenCalledTimes(2)
    expect(event.defaultPrevented).toBe(false)
  })

  it('captures the pointer of a press', () => {
    const { button, capture } = attached()
    pointer(button, 'pointerdown', { pointerId: 7 })
    expect(capture).toHaveBeenCalledWith(7)
  })

  it('repeats a held press after the delay, then every interval, until release', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY - 1)
    expect(action).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(action).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(HOLD_INTERVAL)
    expect(action).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(HOLD_INTERVAL * 3)
    expect(action).toHaveBeenCalledTimes(5)
    pointer(button, 'pointerup')
    vi.advanceTimersByTime(HOLD_INTERVAL * 10)
    expect(action).toHaveBeenCalledTimes(5)
  })

  it('swallows the click that ends a repeated press, not the next one', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY)
    pointer(button, 'pointerup')
    const ending = clickEvent(button)
    expect(ending.defaultPrevented).toBe(true)
    expect(action).toHaveBeenCalledTimes(1)
    button.click()
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('stops when the press is cancelled, and a click after it acts', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY)
    pointer(button, 'pointercancel')
    vi.advanceTimersByTime(HOLD_INTERVAL * 10)
    expect(action).toHaveBeenCalledTimes(1)
    button.click()
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('stops when the pointer capture is lost', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY + HOLD_INTERVAL)
    expect(action).toHaveBeenCalledTimes(2)
    pointer(button, 'lostpointercapture')
    vi.advanceTimersByTime(HOLD_INTERVAL * 10)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('stops before the first repeat when released early', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    pointer(button, 'pointerup')
    vi.advanceTimersByTime(HOLD_DELAY * 5)
    expect(action).not.toHaveBeenCalled()
  })

  it('ignores presses of other buttons', () => {
    const { button, action, capture } = attached()
    pointer(button, 'pointerdown', { button: 2 })
    vi.advanceTimersByTime(HOLD_DELAY * 5)
    expect(action).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('takes its delay and interval from the options', () => {
    const { button, action } = attached({ delay: 100, interval: 10 })
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(99)
    expect(action).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1 + 30)
    expect(action).toHaveBeenCalledTimes(4)
  })

  it('starts over on a new press', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY - 100)
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY - 1)
    expect(action).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('starts no hold on a disabled button', () => {
    const { button, action, capture } = attached()
    button.disabled = true
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY * 5)
    expect(action).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('stops a hold when the button becomes disabled, and the next click acts', () => {
    const { button, action } = attached()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY + HOLD_INTERVAL)
    expect(action).toHaveBeenCalledTimes(2)
    button.disabled = true
    vi.advanceTimersByTime(HOLD_INTERVAL * 10)
    expect(action).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
    button.disabled = false
    button.click()
    expect(action).toHaveBeenCalledTimes(3)
  })

  it('prevents the context menu during a press only', () => {
    const { button } = attached()
    const menu = (): boolean => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      button.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(menu()).toBe(false)
    pointer(button, 'pointerdown', { pointerType: 'touch' })
    vi.advanceTimersByTime(HOLD_DELAY + HOLD_INTERVAL)
    expect(menu()).toBe(true)
    pointer(button, 'pointerup', { pointerType: 'touch' })
    expect(menu()).toBe(false)
  })

  it('clears its timers and listeners when detached', () => {
    const { button, action, detach } = setup()
    pointer(button, 'pointerdown')
    vi.advanceTimersByTime(HOLD_DELAY)
    expect(action).toHaveBeenCalledTimes(1)
    detach()
    vi.advanceTimersByTime(HOLD_INTERVAL * 10)
    button.click()
    expect(action).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
