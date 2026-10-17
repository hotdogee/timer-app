<!--
  @component
  A modal dialog on the native `<dialog>`: the browser traps focus, makes the page inert, closes
  on Esc and returns focus to where it was. `open` is bindable and follows every way of closing
  (Esc, backdrop click, `open = false`); `onclose` runs once per close, whatever the cause.

  Width and padding come from `--dialog-width` and `--dialog-padding`. `placement="top"` sits the
  dialog near the top of the screen, as a command palette does.

  ```svelte
  <Dialog bind:open label="Keyboard shortcuts">…</Dialog>
  ```
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLDialogAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLDialogAttributes, 'children' | 'open' | 'onclose'> {
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
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  })

  function handleClose() {
    open = false
    onclose?.()
  }

  function handlePointerDown(event: PointerEvent) {
    pressedBackdrop = event.target === element
  }

  function handleClick(event: MouseEvent) {
    if (closeOnBackdrop && pressedBackdrop && event.target === element) element?.close()
    pressedBackdrop = false
  }
</script>

<!-- Backdrop clicks are a pointer convenience; Esc is the keyboard way to close (native). -->
<dialog
  bind:this={element}
  {...rest}
  class={['dialog', placement, className]}
  aria-label={label ?? rest['aria-label']}
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
