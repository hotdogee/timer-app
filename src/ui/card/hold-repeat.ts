/**
 * Press-and-hold repeat for a button, as an attachment: the steppers over an idle timer's time
 * (TimerCard) run the duration up or down while held, as a spin button does.
 *
 * A press acts through the button's `click`, not the pointer, so a keyboard or assistive
 * technology activation acts too, once. Holding the primary button (or a finger) acts again after
 * `delay` and then every `interval` until the press ends; the `click` that ends such a press is
 * swallowed, or a hold would act once more on release. The press captures the pointer, so the
 * repeat stops wherever the pointer is released, when the browser cancels it (the page scrolls)
 * and when the capture is lost. A disabled element starts no hold, and a hold stops when the
 * element becomes disabled (a ▼ reaching the last unit it may take away): browsers still send
 * pointer events to disabled buttons, though not clicks. A touch held this long would open the
 * context menu: prevented while pressed.
 *
 * ```svelte
 * <button type="button" {@attach holdRepeat(() => step('minutes', 'up'))}>▲</button>
 * ```
 */
import type { Attachment } from 'svelte/attachments'

/** How long a press is held before it repeats, in milliseconds. */
export const HOLD_DELAY = 400

/** The time between repeats of a held press, in milliseconds. */
export const HOLD_INTERVAL = 60

export interface HoldRepeatOptions {
  /** Milliseconds a press is held before the first repeat ({@link HOLD_DELAY}). */
  readonly delay?: number
  /** Milliseconds between repeats ({@link HOLD_INTERVAL}). */
  readonly interval?: number
}

/**
 * Calls `action` on every click of the element, and over and over while it is held (see the
 * module comment). Timers and listeners go when the element is detached.
 */
export function holdRepeat(
  action: () => void,
  { delay = HOLD_DELAY, interval = HOLD_INTERVAL }: HoldRepeatOptions = {},
): Attachment<HTMLElement> {
  return (element) => {
    let delayTimer: ReturnType<typeof setTimeout> | undefined
    let repeatTimer: ReturnType<typeof setInterval> | undefined
    /** A press is under way. */
    let pressing = false
    /** The press repeated: the click that ends it is not a click of its own. */
    let repeated = false

    const stop = (): void => {
      clearTimeout(delayTimer)
      clearInterval(repeatTimer)
      delayTimer = undefined
      repeatTimer = undefined
      pressing = false
    }

    const repeat = (): void => {
      if (element.matches(':disabled')) {
        // A disabled button gets no click: the next click is one of its own.
        stop()
        repeated = false
        return
      }
      repeated = true
      action()
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || element.matches(':disabled')) return
      stop()
      pressing = true
      repeated = false
      element.setPointerCapture(event.pointerId)
      delayTimer = setTimeout(() => {
        delayTimer = undefined
        repeat()
        repeatTimer = setInterval(repeat, interval)
      }, delay)
    }

    // No click follows a cancelled press, so a later click (the keyboard's) is a click again.
    const onPointerCancel = (): void => {
      stop()
      repeated = false
    }

    const onClick = (event: MouseEvent): void => {
      if (repeated) {
        repeated = false
        event.preventDefault()
        return
      }
      action()
    }

    const onContextMenu = (event: Event): void => {
      if (pressing) event.preventDefault()
    }

    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointerup', stop)
    element.addEventListener('pointercancel', onPointerCancel)
    element.addEventListener('lostpointercapture', stop)
    element.addEventListener('click', onClick)
    element.addEventListener('contextmenu', onContextMenu)
    return () => {
      stop()
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointerup', stop)
      element.removeEventListener('pointercancel', onPointerCancel)
      element.removeEventListener('lostpointercapture', stop)
      element.removeEventListener('click', onClick)
      element.removeEventListener('contextmenu', onContextMenu)
    }
  }
}
