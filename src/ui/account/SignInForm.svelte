<!--
  @component
  The sign-in form, shared by Settings › Account and the device approval page (plan › Account UI):
  an email field and "Send code"; then the emailed code (numeric keyboard, filled in from the
  email by the browser where it can), "Sign in", "Use another email" and "Send a new code"; and on
  the first step one "Continue with …" button per OAuth provider the server has, which leave the
  page for the provider and come back signed in (or with the auth state's `oauth` error, which
  shows under them).

  A full code signs in by itself, once per code, and the text the code field is described by says
  so (with where the code went and when it expires); Enter works on both steps. Each step's field
  takes focus when the step appears, and errors show under the field they concern (announced
  politely), so a keyboard or screen-reader user never has to look for them. Once a code is spent
  (five wrong tries, or expired), trying it again repeats why and moves focus to "Send a new code"
  instead of calling a right code wrong. `focus()` moves focus to the current step's field.

  ```svelte
  <SignInForm {auth} onsignedin={() => (justSignedIn = true)} />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import { m } from '../../i18n'
  import type { Provider } from '../../sync/protocol'
  import { announce } from '../announce.svelte'
  import Button from '../primitives/Button.svelte'
  import TextField from '../primitives/TextField.svelte'
  import { authErrorMessage, sentences } from './errors'
  import { PROVIDER_NAMES, continueWithLabel } from './providers'
  import {
    CODE_LENGTH,
    CODE_LIFETIME_MINUTES,
    codeDigits,
    isCompleteCode,
    isEmailAddress,
  } from './sign-in'
  import type { AccountAuth } from './types'

  interface Props {
    auth: AccountAuth
    /** Focus the email field when the form appears (after signing out, say). */
    autofocus?: boolean
    /** Runs once the code was accepted. */
    onsignedin?: () => void
  }

  let { auth, autofocus = false, onsignedin }: Props = $props()

  /** What is waiting on the server: sending a code, a new code, signing in, or a provider. */
  type Pending = 'send' | 'resend' | 'verify' | Provider | null

  let step = $state<'email' | 'code'>('email')
  let email = $state('')
  /** The address the code went to; the code step signs in with it. */
  let sentTo = $state('')
  let code = $state('')
  let pending = $state<Pending>(null)
  let emailError = $state<string>()
  let codeError = $state<string>()
  let providerError = $state('')
  /** "We sent a new code." under the code field. */
  let notice = $state<string>()
  /** The last whole code tried, so a whole code signs in once, not on every edit. */
  let lastTried = ''
  /**
   * Why the code sent to `sentTo` can no longer sign in (too many wrong tries, or expired), once
   * the server said so; cleared when a new code is sent.
   */
  let spent = $state<string>()

  const uid = $props.id()
  const sentId = `${uid}-sent`

  /** A provider sign-in that failed on the provider's side, reported when the page came back. */
  const oauthFailure = $derived(auth.error === 'oauth' ? authErrorMessage('oauth') : '')

  /** Where the code went, when it expires, and that a whole code signs in by itself. */
  const sentText = $derived(
    sentences(
      sentences(
        m.account_code_sent({ length: CODE_LENGTH, email: sentTo }),
        m.account_code_expires({ count: CODE_LIFETIME_MINUTES }),
      ),
      m.account_code_auto({ length: CODE_LENGTH }),
    ),
  )

  let emailInput = $state<HTMLInputElement>()
  let codeInput = $state<HTMLInputElement>()
  let newCodeButton = $state<HTMLButtonElement>()

  /** Focuses the current step's field. */
  export function focus(): void {
    ;(step === 'email' ? emailInput : codeInput)?.focus()
  }

  /** Set once `autofocus` has had its effect, so later steps keep their own focus. */
  let autofocused = false
  $effect(() => {
    if (!autofocus || autofocused || emailInput === undefined) return
    autofocused = true
    emailInput.focus()
  })

  async function sendCode(event?: SubmitEvent) {
    event?.preventDefault()
    if (pending !== null) return
    const address = email.trim()
    if (!isEmailAddress(address)) {
      emailError = m.account_error_invalid_email()
      emailInput?.focus()
      return
    }
    emailError = undefined
    providerError = ''
    pending = 'send'
    const sent = await auth.sendCode(address)
    pending = null
    if (!sent) {
      emailError = authErrorMessage(auth.error ?? 'unknown')
      emailInput?.focus()
      return
    }
    sentTo = address
    code = ''
    lastTried = ''
    spent = undefined
    codeError = undefined
    notice = undefined
    step = 'code'
    await tick()
    codeInput?.focus()
  }

  async function sendNewCode() {
    if (pending !== null) return
    codeError = undefined
    notice = undefined
    pending = 'resend'
    const sent = await auth.sendCode(sentTo)
    pending = null
    if (sent) {
      code = ''
      lastTried = ''
      spent = undefined
      notice = m.account_code_resent()
    } else {
      codeError = authErrorMessage(auth.error ?? 'unknown')
    }
    codeInput?.focus()
  }

  async function signIn(event?: SubmitEvent) {
    event?.preventDefault()
    if (pending !== null) return
    if (spent !== undefined) {
      // The server deleted this code: no code, right or wrong, can sign in with it now.
      codeError = spent
      newCodeButton?.focus()
      return
    }
    if (!isCompleteCode(code)) {
      codeError = m.account_error_enter_code({ length: CODE_LENGTH })
      codeInput?.focus()
      return
    }
    codeError = undefined
    notice = undefined
    lastTried = code
    pending = 'verify'
    const signedIn = await auth.verifyCode(sentTo, code)
    pending = null
    if (!signedIn) {
      const reason = auth.error ?? 'unknown'
      codeError = authErrorMessage(reason)
      if (reason === 'too-many-attempts' || reason === 'expired-code') {
        spent = codeError
        newCodeButton?.focus()
        return
      }
      codeInput?.focus()
      codeInput?.select()
      return
    }
    announce(m.account_signed_in_as({ email: auth.user?.email ?? sentTo }))
    onsignedin?.()
  }

  /**
   * The code field's binding: keeps the code to its digits (a pasted "123 456" works; the field
   * shows what is kept) and signs in once it is whole.
   */
  function editCode(value: string) {
    const digits = codeDigits(value)
    code = digits
    notice = undefined
    if (isCompleteCode(digits) && digits !== lastTried && spent === undefined) void signIn()
  }

  async function useAnotherEmail() {
    if (pending === 'verify') return
    step = 'email'
    codeError = undefined
    notice = undefined
    await tick()
    emailInput?.focus()
    emailInput?.select()
  }

  async function continueWith(provider: Provider) {
    if (pending !== null) return
    providerError = ''
    emailError = undefined
    pending = provider
    // On success the page is on its way to the provider; the button keeps saying so.
    if (!(await auth.signInWith(provider))) {
      pending = null
      providerError = authErrorMessage(auth.error ?? 'unknown')
    }
  }

  /** Back from the provider through the browser's Back button: the page is live again. */
  function pageShown(event: PageTransitionEvent) {
    if (event.persisted && pending !== null && pending !== 'verify') pending = null
  }

  function providerButtonLabel(provider: Provider): string {
    return pending === provider
      ? m.account_redirecting({ provider: PROVIDER_NAMES[provider] })
      : continueWithLabel(provider)
  }
</script>

<svelte:window onpageshow={pageShown} />

<div class="sign-in">
  {#if step === 'email'}
    <form class="step" novalidate onsubmit={sendCode}>
      <div class="field-row">
        <TextField
          class="grow"
          label={m.account_email()}
          type="email"
          name="email"
          autocomplete="email"
          inputmode="email"
          autocapitalize="none"
          spellcheck="false"
          bind:value={email}
          bind:element={emailInput}
          error={emailError}
          oninput={() => {
            emailError = undefined
          }}
        />
        <Button
          type="submit"
          label={pending === 'send' ? m.account_sending() : m.account_send_code()}
          aria-busy={pending === 'send'}
        />
      </div>
    </form>
    {#if auth.providers.length > 0}
      <div class="divider"><span>{m.account_or()}</span></div>
      <div class="providers">
        {#each auth.providers as provider (provider)}
          <Button
            variant="tonal"
            fullWidth
            label={providerButtonLabel(provider)}
            aria-busy={pending === provider}
            onclick={() => {
              void continueWith(provider)
            }}
          />
        {/each}
        <p class="error" role="alert">{providerError || oauthFailure}</p>
      </div>
    {/if}
  {:else}
    <form class="step" novalidate onsubmit={signIn}>
      <p class="sent" id={sentId}>{sentText}</p>
      <div class="field-row">
        <TextField
          class="grow code"
          label={m.account_code()}
          name="code"
          inputmode="numeric"
          autocomplete="one-time-code"
          pattern="[0-9]*"
          spellcheck="false"
          bind:value={() => code, editCode}
          bind:element={codeInput}
          aria-describedby={sentId}
          error={codeError}
          supportingText={notice}
        />
        <Button
          type="submit"
          label={pending === 'verify' ? m.account_signing_in() : m.account_sign_in()}
          aria-busy={pending === 'verify'}
        />
      </div>
      <div class="links">
        <Button variant="text" label={m.account_use_another_email()} onclick={useAnotherEmail} />
        <Button
          variant="text"
          label={pending === 'resend' ? m.account_sending() : m.account_send_new_code()}
          aria-busy={pending === 'resend'}
          bind:element={newCodeButton}
          onclick={() => {
            void sendNewCode()
          }}
        />
      </div>
    </form>
  {/if}
</div>

<style>
  .sign-in {
    container: sign-in / inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .step {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0;
  }

  /* The field and its button side by side, the button at the field's height; stacked when the
     form is narrow. */
  .field-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2) var(--space-3);
  }

  .field-row :global(.grow) {
    flex: 1 1 14rem;
  }

  .field-row :global(.code) {
    flex-basis: 10rem;
  }

  .field-row :global(.code input) {
    font-size: 1.125rem;
    letter-spacing: 0.2em;
  }

  @container sign-in (max-width: 24rem) {
    .field-row > :global(.button) {
      flex: 1 1 100%;
    }
  }

  .sent {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
    overflow-wrap: anywhere;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    margin-inline-start: calc(var(--space-3) * -1);
  }

  /* "or" between two rules. */
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-block-start: 1px solid var(--md-sys-color-outline-variant);
  }

  .providers {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .error {
    margin: 0;
    color: var(--md-sys-color-error);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  /* The alert stays in the page while empty, so its text is announced when it appears. */
  .error:empty {
    margin-block-start: calc(var(--space-2) * -1);
  }

  @media (forced-colors: active) {
    .divider::before,
    .divider::after {
      border-color: CanvasText;
    }
  }
</style>
