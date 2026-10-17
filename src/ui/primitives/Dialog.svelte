<!--
  @component
  A modal dialog on the native `<dialog>`: the browser traps focus, makes the page inert, closes
  on Esc and returns focus to where it was. `open` is bindable and follows every way of closing
  (Esc, backdrop click, `open = false`) at once; `onclose` runs once per close, whatever the cause,
  except for a close the dialog was reopened right after (its late `close` event is ignored).

  Width and padding come from `--dialog-width` and `--dialog-padding`. `placement="top"` sits the
  dialog near the top of the screen, as a command palette does.

  ```svelte
  <Dialog bind:open label="Keyboard shortcuts">…</Dialog>
  ```
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLDialogAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLDialogAttributes, 'children' | 'open' | 'onclose' | 'oncancel'> {
    /** Whether the dialog is shown. Bindable; set to false when the dialog closes itself. */
    open?: boolean
    /** Accessible name, when no visible heading is referenced with `aria-labelledby`. */
    label?: string
    placement?: 'center' | 'top'
    /** Close when the backdrop is clicked. */
    closeOnBackdrop?: boolean
    /** Runs after the dialog closes. */
    onclose?: () => void
    /** The rendered `<dialog>`. */
    element?: HTMLDialogElement | undefined
    children: Snippet
  }

  let {
    open = $bindable(false),
    label,
    placement = 'center',
    closeOnBackdrop = true,
    onclose,
    element = $bindable(),
    children,
    class: className,
    ...rest
  }: Props = $props()

  // A press that starts inside the content and ends on the backdrop (selecting text, say) is not
  // a backdrop click; only presses that start and end on the backdrop close the dialog.
  let pressedBackdrop = false

  $effect(() => {
    const dialog = element
    if (!dialog) return
    if (open) {
      if (!dialog.open) dialog.showModal()
      return
    }
    if (dialog.open) dialog.close()
    // Opened from the page itself, the dialog has no control to give focus back to, and focus
    // stays on its hidden content until the browser notices. Let it go now, so the next key
    // press (one that opens this dialog again, say) is the page's and not lost in the dialog.
    const active = dialog.ownerDocument.activeElement
    if (active instanceof HTMLElement && dialog.contains(active)) active.blur()
  })

  /**
   * Esc (or another close request): `open` follows at once, not on the `close` event a task later,
   * so a shortcut pressed right after (opening this dialog again, say) sees it closed.
   */
  function handleCancel(event: Event) {
    if (!event.defaultPrevented) open = false
  }

  function handleClose() {
    // A close event left over from closing just before the dialog was opened again: it is open.
    if (element?.open === true) return
    open = false
    onclose?.()
  }

  function handlePointerDown(event: PointerEvent) {
    pressedBackdrop = event.target === element
  }

  function handleClick(event: MouseEvent) {
    if (closeOnBackdrop && pressedBackdrop && event.target === element) {
      element.close()
      open = false
    }
    pressedBackdrop = false
  }
</script>

<!-- Backdrop clicks are a pointer convenience; Esc is the keyboard way to close (native). -->
<dialog
  bind:this={element}
  {...rest}
  class={['dialog', placement, className]}
  aria-label={label ?? rest['aria-label']}
  oncancel={handleCancel}
  onclose={handleClose}
  onpointerdown={handlePointerDown}
  onclick={handleClick}
>
  <div class="content">
    {@render children()}
  </div>
</dialog>

<style>
  .dialog {
    inline-size: min(var(--dialog-width, 35rem), calc(100vw - 2rem));
    max-inline-size: none;
    max-block-size: calc(100dvh - 2rem);
    padding: 0;
    border: none;
    border-radius: var(--radius-dialog, 28px);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-on-surface);
    box-shadow: var(--shadow-3);
    overflow: hidden;
  }

  .dialog[open] {
    display: flex;
    flex-direction: column;
    animation: dialog-in var(--duration-medium, 300ms) var(--easing-decelerate, ease-out);
  }

  .top {
    margin-block-start: min(12vh, 8rem);
  }

  .content {
    min-block-size: 0;
    padding: var(--dialog-padding, 1.5rem);
    overflow: auto;
  }

  .dialog::backdrop {
    background: color-mix(in srgb, var(--md-sys-color-scrim, #000) 32%, transparent);
  }

  .dialog[open]::backdrop {
    animation: backdrop-in var(--duration-medium, 300ms) var(--easing-standard, ease);
  }

  @keyframes dialog-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
  }

  @media (forced-colors: active) {
    .dialog {
      border: 1px solid CanvasText;
    }
  }
</style>
