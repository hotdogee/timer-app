<!--
  @component
  A Material 3 snackbar: a short message with an optional action ("Deleted Timer · Undo"), at the
  bottom of the screen. It hides itself after `timeout` ms; hovering or focusing it pauses the
  countdown (WCAG 2.2.1), which restarts in full afterwards. Change `key` to restart the countdown
  for a new message while it is already showing.

  The message sits in a `role="status"` region that stays in the page, so screen readers announce
  each new message politely. An app with its own live region passes `live={false}` and announces
  the message there instead. `hint` adds text for screen readers only, such as the keyboard
  shortcut for the action. Lift it above other floating UI with `--snackbar-offset`.

  ```svelte
  <Snackbar bind:open message="Deleted Timer 2" actionLabel="Undo" onaction={undo} key={deletedId} />
  ```
-->
<script lang="ts">
  import { prefersReducedMotion } from 'svelte/motion'
  import { fly } from 'svelte/transition'

  interface Props {
    /** Whether the snackbar is shown. Bindable; set to false when it hides itself. */
    open?: boolean
    message: string
    /** Text of the action button; no button without it. */
    actionLabel?: string
    onaction?: () => void
    /** Milliseconds until it hides itself. 0 keeps it until `open` is set to false. */
    timeout?: number
    /** Any value; changing it restarts the countdown (a second delete while one is showing). */
    key?: unknown
    /** Runs when the snackbar hides itself: after the timeout or after its action. */
    onclose?: (reason: 'timeout' | 'action') => void
    /** Whether the message is a live region that screen readers announce. */
    live?: boolean
    /** Extra text for screen readers, after the message ("Press Ctrl+Z to undo."). */
    hint?: string | undefined
  }

  let {
    open = $bindable(false),
    message,
    actionLabel,
    onaction,
    timeout = 6000,
    key,
    onclose,
    live = true,
    hint,
  }: Props = $props()

  let hovered = $state(false)
  let focused = $state(false)

  $effect(() => {
    // Restart the countdown for a new message or key.
    void message
    void key
    if (!open || hovered || focused || timeout <= 0) return
    const timer = setTimeout(() => {
      open = false
      onclose?.('timeout')
    }, timeout)
    return () => {
      clearTimeout(timer)
    }
  })

  // A closed snackbar is neither hovered nor focused; don't carry that into the next one.
  $effect(() => {
    if (open) return
    hovered = false
    focused = false
  })

  function act() {
    onaction?.()
    open = false
    onclose?.('action')
  }
</script>

<div class="region" role={live ? 'status' : undefined}>
  {#if open}
    <!-- Hover and focus only pause the countdown; the action button is the interactive part. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="snackbar"
      transition:fly={{ y: 16, duration: prefersReducedMotion.current ? 0 : 200 }}
      onpointerenter={() => {
        hovered = true
      }}
      onpointerleave={() => {
        hovered = false
      }}
      onfocusin={() => {
        focused = true
      }}
      onfocusout={() => {
        focused = false
      }}
    >
      <span class="message"
        >{message}{#if hint}<span class="visually-hidden">&nbsp;{hint}</span>{/if}</span
      >
      {#if actionLabel}
        <button type="button" class="action" onclick={act}>{actionLabel}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .region {
    position: fixed;
    inset-block-end: var(--snackbar-offset, var(--space-4, 1rem));
    inset-inline: var(--space-4, 1rem);
    z-index: 20;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }

  .snackbar {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    min-block-size: 3rem;
    max-inline-size: min(42rem, 100%);
    padding-block: var(--space-1, 0.25rem);
    padding-inline: var(--space-4, 1rem) var(--space-2, 0.5rem);
    border-radius: 4px;
    background: var(--md-sys-color-inverse-surface);
    color: var(--md-sys-color-inverse-on-surface);
    box-shadow: var(--shadow-3);
    font-size: 0.875rem;
    line-height: 1.43;
    pointer-events: auto;
  }

  .message {
    flex: 1;
    padding-block: var(--space-2, 0.5rem);
  }

  .action {
    position: relative;
    flex: none;
    min-block-size: var(--touch-target, 44px);
    padding-inline: var(--space-3, 0.75rem);
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    background: transparent;
    color: var(--md-sys-color-inverse-primary);
    font-weight: 500;
    cursor: pointer;
  }

  .action::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
  }

  .action:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .action:focus-visible {
    outline-color: var(--md-sys-color-inverse-primary);
  }

  .action:focus-visible::before,
  .action:active::before {
    opacity: var(--state-focus, 0.1);
  }

  @media (forced-colors: active) {
    .snackbar {
      border: 1px solid CanvasText;
    }

    .action::before {
      display: none;
    }
  }
</style>
