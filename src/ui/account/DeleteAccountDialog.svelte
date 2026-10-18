<!--
  @component
  "Delete your account?" (plan › Account UI): says what is deleted (the account, its sign-in
  methods and the server's copy of the data; other devices stop syncing) and what stays (the cards
  on this device), and deletes only once the word DELETE is typed. It opens with focus in that
  field; Enter confirms once the word is right; Esc, Cancel or the backdrop cancel, except while
  the deletion is on its way. A failure stays in the dialog, under the field.

  The modal dialog makes the page inert, so it carries its own copy of the app's live region. It
  sets its own padding: it opens inside the settings dialog, whose zero padding would be inherited.

  ```svelte
  <DeleteAccountDialog bind:open {auth} ondeleted={() => announce(m.account_deleted())} />
  ```
-->
<script lang="ts">
  import { m } from '../../i18n'
  import Announcer from '../Announcer.svelte'
  import Button from '../primitives/Button.svelte'
  import Dialog from '../primitives/Dialog.svelte'
  import TextField from '../primitives/TextField.svelte'
  import { DELETE_CONFIRMATION_WORD, isDeleteConfirmed } from './delete'
  import { authErrorMessage, sentences } from './errors'
  import type { AccountAuth } from './types'

  interface Props {
    /** Whether the dialog is shown. Bindable; it sets this to false when it closes. */
    open?: boolean
    auth: Pick<AccountAuth, 'deleteAccount' | 'error'>
    /** Runs once the account is gone and the dialog has closed. */
    ondeleted: () => void
  }

  let { open = $bindable(false), auth, ondeleted }: Props = $props()

  const uid = $props.id()
  const headingId = `${uid}-heading`
  const messageId = `${uid}-message`

  let dialog = $state<HTMLDialogElement>()
  let typed = $state('')
  let deleting = $state(false)
  let error = $state<string>()

  const confirmed = $derived(isDeleteConfirmed(typed))

  // Each opening starts empty.
  $effect.pre(() => {
    if (!open) return
    typed = ''
    error = undefined
  })

  function close(): void {
    if (dialog?.open) dialog.close()
    open = false
  }

  async function remove(event: SubmitEvent): Promise<void> {
    event.preventDefault()
    if (!confirmed || deleting) return
    deleting = true
    error = undefined
    const deleted = await auth.deleteAccount()
    deleting = false
    if (!deleted) {
      error = sentences(m.account_delete_error(), authErrorMessage(auth.error ?? 'unknown'))
      return
    }
    close()
    ondeleted()
  }

  /** While the deletion is on its way the dialog stays, so its outcome has somewhere to show. */
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && deleting) event.preventDefault()
  }
</script>

<Dialog
  bind:open
  bind:element={dialog}
  role="alertdialog"
  aria-labelledby={headingId}
  aria-describedby={messageId}
  closeOnBackdrop={!deleting}
  style="--dialog-width: 28rem; --dialog-padding: 1.5rem"
  onkeydown={handleKeydown}
>
  <form class="form" novalidate onsubmit={remove}>
    <h2 id={headingId} class="title">{m.account_delete_title()}</h2>
    <p id={messageId} class="message">{m.account_delete_message()}</p>
    <TextField
      label={m.account_delete_type({ word: DELETE_CONFIRMATION_WORD })}
      name="confirm"
      autocomplete="off"
      autocapitalize="characters"
      spellcheck="false"
      autofocus
      bind:value={typed}
      {error}
    />
    <div class="actions">
      <Button variant="text" label={m.common_cancel()} disabled={deleting} onclick={close} />
      <Button
        type="submit"
        variant="tonal"
        label={deleting ? m.account_deleting() : m.account_delete()}
        disabled={!confirmed}
        aria-busy={deleting}
      />
    </div>
  </form>
  <Announcer />
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
  }

  .title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 2rem;
  }

  .message {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-block-start: var(--space-2);
    --button-tonal-container: var(--md-sys-color-error);
    --button-tonal-content: var(--md-sys-color-on-error);
  }
</style>
