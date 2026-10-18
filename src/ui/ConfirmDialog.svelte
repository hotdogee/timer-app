<!--
  @component
  A Material 3 basic dialog that asks before something happens ("Delete Tea?"), with Cancel and a
  confirming action. It opens with focus on the confirming button, so Enter confirms; Esc, Cancel
  or a backdrop click cancel. Confirming closes the dialog first, so focus is back where it was
  (the card or its delete button) before `onconfirm` runs, and whatever `onconfirm` removes hands
  focus on as usual. The modal dialog makes the page inert, so it carries its own copy of the
  app's live region. It sets its own padding: it may open inside the settings dialog (Data's
  import question), whose zero padding would be inherited.

  ```svelte
  <ConfirmDialog
    bind:open
    title={m.confirm_delete_title({ name })}
    confirmLabel={m.confirm_delete_confirm()}
    cancelLabel={m.confirm_delete_cancel()}
    onconfirm={remove}
  />
  ```
-->
<script lang="ts">
  import Announcer from './Announcer.svelte'
  import Button from './primitives/Button.svelte'
  import Dialog from './primitives/Dialog.svelte'

  interface Props {
    /** Whether the dialog is shown. Bindable; it sets this to false when it closes. */
    open?: boolean
    /** The question, as the dialog's headline and accessible name. */
    title: string
    /** Optional supporting text under the headline. */
    message?: string | undefined
    confirmLabel: string
    cancelLabel: string
    /** Runs after the dialog closed by confirming. */
    onconfirm: () => void
    /** Runs after the dialog closed any other way (Cancel, Esc, the backdrop). */
    oncancel?: (() => void) | undefined
  }

  let {
    open = $bindable(false),
    title,
    message,
    confirmLabel,
    cancelLabel,
    onconfirm,
    oncancel,
  }: Props = $props()

  const uid = $props.id()
  const headingId = `${uid}-heading`
  const messageId = `${uid}-message`

  let dialog = $state<HTMLDialogElement>()
  /** Set while closing by confirming, so the close counts as a confirm, not a cancel. */
  let confirming = false

  function close(): void {
    // Closing the native dialog now (not on the next effect) returns focus before onconfirm.
    if (dialog?.open) dialog.close()
    open = false
  }

  function confirm(): void {
    confirming = true
    close()
  }

  function cancel(): void {
    close()
  }

  function handleClose(): void {
    const confirmed = confirming
    confirming = false
    if (confirmed) onconfirm()
    else oncancel?.()
  }

  function handleKeydown(event: KeyboardEvent): void {
    // Enter confirms from anywhere in the dialog except a button, which acts on its own.
    if (event.key !== 'Enter' || event.isComposing) return
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    event.stopPropagation()
    confirm()
  }
</script>

<Dialog
  bind:open
  bind:element={dialog}
  role="alertdialog"
  aria-labelledby={headingId}
  aria-describedby={message ? messageId : undefined}
  style="--dialog-width: 22rem; --dialog-padding: 1.5rem"
  onclose={handleClose}
  onkeydown={handleKeydown}
>
  <h2 id={headingId} class="title">{title}</h2>
  {#if message}
    <p id={messageId} class="message">{message}</p>
  {/if}
  <div class="actions">
    <Button variant="text" label={cancelLabel} onclick={cancel} />
    <Button label={confirmLabel} autofocus onclick={confirm} />
  </div>
  <Announcer />
</Dialog>

<style>
  .title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 2rem;
    overflow-wrap: anywhere;
    text-wrap: balance;
  }

  .message {
    margin: var(--space-4, 1rem) 0 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2, 0.5rem);
    margin-block-start: var(--space-5, 1.5rem);
  }
</style>
