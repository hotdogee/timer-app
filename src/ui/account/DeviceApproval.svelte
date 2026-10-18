<!--
  @component
  The device approval page at `/device` (plan › Device approval page), the web half of the desktop
  app's sign-in: the desktop app shows a code and opens this page with `?user_code=`. The page
  shows that code (editable, for one typed by hand), asks the visitor to sign in first (the same
  form as Settings › Account), then offers "Approve this device" and "Deny". Approving or denying
  ends on a result ("Device approved", "Request denied") with focus on it; a failure (a wrong or
  expired code, one already used or claimed by another account, no connection) shows under the
  code or the buttons. "Use another account" signs out first (announced, with focus in the sign-in
  form's email field); "Back to Timer App" leaves. The sign-in part links the privacy policy, as
  Settings › Account does, since a first-time visitor creates an account here.

  `main.ts` mounts it as a page of its own on the device path, instead of the app: it brings its
  `<main>` and heading.

  ```svelte
  <DeviceApproval />
  ```
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'

  import { m } from '../../i18n'
  import { authClient, authStore } from '../../state/auth.svelte'
  import { announce } from '../announce.svelte'
  import Button from '../primitives/Button.svelte'
  import TextField from '../primitives/TextField.svelte'
  import Glyph from '../settings/Glyph.svelte'
  import { checkingPatience } from './checking.svelte'
  import { createDeviceApproval, tidyUserCode, userCodeFromSearch } from './device'
  import { authErrorMessage, deviceErrorKind, deviceErrorMessage } from './errors'
  import { PRIVACY_POLICY_URL } from './privacy'
  import SignInForm from './SignInForm.svelte'
  import type { AccountAuth, DeviceApprovalApi } from './types'

  interface Props {
    /** The app's auth state by default. */
    auth?: AccountAuth
    /** Approve and deny on the app's Better Auth client by default. */
    device?: DeviceApprovalApi
    /** The code to start with; the page's `?user_code=` by default. */
    userCode?: string
    /** Where "Back to Timer App" goes. */
    homeHref?: string
  }

  let {
    auth = authStore,
    device = createDeviceApproval(authClient),
    userCode = typeof location === 'undefined' ? '' : userCodeFromSearch(location.search),
    homeHref = '/',
  }: Props = $props()

  const uid = $props.id()
  const signInHeadingId = `${uid}-sign-in`

  // The prop is only where the field starts; the field is the visitor's from then on.
  let code = $state(untrack(() => tidyUserCode(userCode)))
  let phase = $state<'ask' | 'approved' | 'denied'>('ask')
  let pending = $state<'approve' | 'deny' | 'sign-out' | null>(null)
  /** A problem with the code itself, under the field. */
  let codeError = $state<string>()
  /** Any other problem, under the buttons. */
  let failure = $state('')
  /** Focus the approve button once signed in on this page. */
  let focusApprove = $state(false)
  /** Focus the sign-in form's email field once signed out here ("Use another account"). */
  let focusSignIn = $state(false)

  let codeInput = $state<HTMLInputElement>()
  let result = $state<HTMLElement>()

  const signedIn = $derived(auth.status === 'signed-in' && auth.user !== null)
  /** Past this, an `unknown` session (the server out of reach) shows the sign-in form anyway. */
  const patience = checkingPatience(() => auth.status === 'unknown')
  const checking = $derived(auth.status === 'unknown' && !patience.expired)

  /** Approve or deny the code in the field; `ask` again on failure, with the reason shown. */
  async function decide(choice: 'approve' | 'deny') {
    if (pending !== null) return
    const userCode = tidyUserCode(code)
    if (userCode === '') {
      codeError = m.device_error_enter_code()
      codeInput?.focus()
      return
    }
    codeError = undefined
    failure = ''
    pending = choice
    try {
      await (choice === 'approve' ? device.approve(userCode) : device.deny(userCode))
    } catch (error) {
      pending = null
      const kind = deviceErrorKind(error)
      const message = deviceErrorMessage(kind)
      if (kind === 'invalid-code' || kind === 'expired-code' || kind === 'already-used') {
        codeError = message
        codeInput?.focus()
      } else {
        failure = message
      }
      return
    }
    pending = null
    phase = choice === 'approve' ? 'approved' : 'denied'
    await tick()
    result?.focus()
  }

  async function useAnotherAccount() {
    if (pending !== null) return
    pending = 'sign-out'
    failure = ''
    const signedOut = await auth.signOut()
    pending = null
    if (!signedOut) {
      failure = authErrorMessage(auth.error ?? 'unknown')
      return
    }
    // The buttons give way to the sign-in form: focus goes to its email field, not the page.
    focusSignIn = true
    announce(m.account_signed_out())
  }

  /** Moves focus to the approve button when it appears after signing in on this page. */
  function focusWhenSignedIn(element: HTMLElement) {
    if (!focusApprove) return
    focusApprove = false
    element.querySelector('button')?.focus()
  }

  const icon = `${import.meta.env.BASE_URL}icon.svg`
</script>

<main class="device-page">
  <div class="sheet">
    <p class="brand">
      <img class="brand-icon" src={icon} alt="" width="32" height="32" />
      <span>{m.app_name()}</span>
    </p>

    {#if phase === 'ask'}
      <h1 class="title">{m.device_title()}</h1>
      <p class="intro">{m.device_intro()}</p>

      <TextField
        class="code"
        label={m.device_code()}
        name="user_code"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        bind:value={code}
        bind:element={codeInput}
        error={codeError}
        oninput={() => {
          codeError = undefined
        }}
        onchange={() => {
          code = tidyUserCode(code)
        }}
      />

      {#if checking}
        <p class="secondary" role="status">{m.account_checking()}</p>
      {:else if !signedIn}
        <section class="sign-in" aria-labelledby={signInHeadingId}>
          <h2 id={signInHeadingId} class="step-title">{m.device_sign_in_first()}</h2>
          <SignInForm
            {auth}
            autofocus={focusSignIn}
            onsignedin={() => {
              focusSignIn = false
              focusApprove = true
            }}
          />
          <p class="privacy">
            <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">
              {m.account_privacy()}
              <span class="external"><Glyph name="open_in_new" /></span>
            </a>
          </p>
        </section>
      {:else}
        <div class="who">
          <p class="secondary">{m.account_signed_in_as({ email: auth.user?.email ?? '' })}</p>
          <Button
            variant="text"
            label={m.device_other_account()}
            aria-busy={pending === 'sign-out'}
            onclick={() => {
              void useAnotherAccount()
            }}
          />
        </div>
        <div class="actions" {@attach focusWhenSignedIn}>
          <Button
            label={pending === 'approve' ? m.device_approving() : m.device_approve()}
            aria-busy={pending === 'approve'}
            onclick={() => {
              void decide('approve')
            }}
          />
          <Button
            variant="tonal"
            label={pending === 'deny' ? m.device_denying() : m.device_deny()}
            aria-busy={pending === 'deny'}
            onclick={() => {
              void decide('deny')
            }}
          />
        </div>
      {/if}
      <p class="failure" role="alert">{failure}</p>
    {:else}
      <div class={['result', phase]}>
        <span class="result-icon">
          <Glyph name={phase === 'approved' ? 'check_circle' : 'block'} />
        </span>
        <h1 class="title" tabindex="-1" bind:this={result}>
          {phase === 'approved' ? m.device_approved_title() : m.device_denied_title()}
        </h1>
        <p class="intro">
          {phase === 'approved' ? m.device_approved_message() : m.device_denied_message()}
        </p>
      </div>
    {/if}

    <p class="back">
      <a href={homeHref}>{m.device_back()}</a>
    </p>
  </div>
</main>

<style>
  .device-page {
    display: grid;
    place-items: start center;
    min-block-size: 100dvh;
    padding: max(var(--space-6), 8vh) var(--space-4) var(--space-6);
    background: var(--app-background, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
  }

  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    inline-size: 100%;
    max-inline-size: 30rem;
    padding: var(--space-6);
    border-radius: var(--radius-dialog, 28px);
    background: var(--md-sys-color-surface-container-high);
    box-shadow: var(--shadow-1);
  }

  p {
    margin: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    font-weight: 500;
  }

  .brand-icon {
    inline-size: 2rem;
    block-size: 2rem;
    border-radius: 22%;
  }

  .title {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 400;
    line-height: 2.25rem;
    text-wrap: balance;
  }

  .title:focus {
    outline: none;
  }

  .title:focus-visible {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 4px;
    border-radius: var(--radius-small, 8px);
  }

  .intro,
  .secondary {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  /* The device code, the page's main field, is taller; the sign-in form keeps its fields at its
     buttons' height, as in Settings. */
  .sheet > :global(.code) {
    --text-field-height: 3rem;
  }

  .sheet :global(.code input) {
    font-size: 1.25rem;
    letter-spacing: 0.15em;
  }

  .sign-in {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    --text-field-height: 2.75rem;
    padding-block-start: var(--space-2);
    border-block-start: 1px solid var(--md-sys-color-outline-variant);
  }

  .step-title {
    margin: 0;
    padding-block-start: var(--space-3);
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5rem;
  }

  /* "Signed in as …" with "Use another account" under it, the button's text lined up with the
     line above (a text button has its padding inside). */
  .who {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
    overflow-wrap: anywhere;
  }

  /* Breaks only at the spaces around the address (CJK would split 登入 otherwise); the address
     itself still wraps anywhere when it is too long. */
  .who p {
    word-break: keep-all;
  }

  .who > :global(.button) {
    margin-inline-start: calc(var(--space-3) * -1);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-3);
  }

  .actions > :global(.button) {
    flex: 1 1 10rem;
  }

  .failure {
    color: var(--md-sys-color-error);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  /* The alert stays in the page while empty, so its text is announced when it appears. */
  .failure:empty {
    margin-block-start: calc(var(--space-4) * -1);
  }

  .result {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .result-icon {
    display: inline-flex;
    font-size: 3rem;
    color: var(--md-sys-color-primary);
  }

  .denied .result-icon {
    color: var(--md-sys-color-on-surface-variant);
  }

  .privacy a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-block-size: var(--touch-target, 44px);
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }

  .privacy a:hover {
    text-decoration: underline;
  }

  .external {
    display: inline-flex;
    font-size: 1rem;
  }

  .back a {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--touch-target, 44px);
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 500;
    text-decoration: none;
  }

  .back a:hover {
    text-decoration: underline;
  }

  @media (max-width: 30rem) {
    .device-page {
      padding-block-start: var(--space-4);
    }

    .sheet {
      padding: var(--space-5) var(--space-4);
    }
  }

  @media (forced-colors: active) {
    .sheet {
      border: 1px solid CanvasText;
    }
  }
</style>
