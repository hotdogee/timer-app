<!--
  @component
  The desktop sign-in through the browser (spec › Sync › Desktop sign-in; plan › UI › Desktop
  sign-in). "Sign in with your browser" asks the server for a code (`auth.startDeviceSignIn`) and
  shows it large, with "Open the browser" (the `/device` page with the code filled in, in the
  system browser), "Copy code" and Cancel, while the app waits for the code to be approved there
  ("Waiting for approval…"; "Still trying" while the server is out of reach) and then signs in by
  itself. The page's address shows too, selectable (RFC 8628 § 3.3), for another device or a
  browser that did not open; when opening fails, that says so, announced. A refusal or an expired
  code says so and offers a new code. The code expires at the time shown under it.

  Focus follows the flow: to "Open the browser" once the code shows (which reads out the steps and
  the code), to "Get a new code" when it ended, and back to "Sign in with your browser" after
  Cancel. Failures to get a code show under the button, announced. `openUrl` (resolving to whether
  the browser opened) and `copyText` default to the platform's opener and the clipboard.

  ```svelte
  <DeviceSignIn {auth} />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import { formatClockTime } from '../../core'
  import { browserLanguages, localeState, m } from '../../i18n'
  import { platform } from '../../platform'
  import { settingsStore } from '../../state/settings.svelte'
  import { clockHourCycle, clockLocale } from '../card/display'
  import Button from '../primitives/Button.svelte'
  import Glyph from '../settings/Glyph.svelte'
  import { formatUserCode, spellUserCode } from './device'
  import { authErrorMessage } from './errors'
  import type { AccountAuth } from './types'

  interface Props {
    auth: AccountAuth
    /** Opens a page in the system browser, resolving to whether it did; the platform's opener. */
    openUrl?: (url: string) => Promise<boolean>
    /** Copies text to the clipboard; resolves to whether it worked. */
    copyText?: (text: string) => Promise<boolean>
  }

  let {
    auth,
    openUrl = (url) => platform.opener.open(url),
    copyText = clipboardCopy,
  }: Props = $props()

  const uid = $props.id()
  const descriptionId = `${uid}-description`
  const titleId = `${uid}-title`
  const stepsId = `${uid}-steps`
  const spokenCodeId = `${uid}-code`

  async function clipboardCopy(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }

  const device = $derived(auth.device ?? null)
  const requesting = $derived(device?.phase === 'requesting')
  const waiting = $derived(device?.phase === 'waiting' ? device : null)
  const code = $derived(waiting === null ? '' : formatUserCode(waiting.userCode))
  const locale = $derived(clockLocale(localeState.current, browserLanguages()))
  const hourCycle = $derived(clockHourCycle(settingsStore.synced.hourCycle))
  const expiresAt = $derived(
    waiting === null ? '' : formatClockTime(waiting.expiresAt, { locale, hourCycle }),
  )
  /** The approval page's address without the code (the page asks for it), to type elsewhere. */
  const address = $derived(waiting === null ? '' : pageAddress(waiting.verificationUrl))

  /** `url` without its query and fragment: `https://timer.example.com/device`. */
  function pageAddress(url: string): string {
    try {
      const parsed = new URL(url)
      return `${parsed.origin}${parsed.pathname}`
    } catch {
      return url
    }
  }

  /** Why getting a code failed, under the button. */
  let failure = $state('')
  /** The outcome of the last copy, announced. */
  let copied = $state('')
  /** The browser did not open (the last "Open the browser" failed). */
  let openFailed = $state(false)
  let startButton = $state<HTMLButtonElement>()
  let openButton = $state<HTMLButtonElement>()
  let retryButton = $state<HTMLButtonElement>()

  async function start() {
    if (requesting) return
    failure = ''
    copied = ''
    openFailed = false
    const started = (await auth.startDeviceSignIn?.()) ?? false
    await tick()
    if (started) {
      openButton?.focus()
      return
    }
    failure = authErrorMessage(auth.error ?? 'unknown')
    startButton?.focus()
  }

  async function cancel() {
    auth.cancelDeviceSignIn?.()
    failure = ''
    copied = ''
    openFailed = false
    await tick()
    startButton?.focus()
  }

  async function copy() {
    if (waiting === null) return
    copied = (await copyText(code)) ? m.account_device_copied() : m.account_device_copy_failed()
  }

  async function open(url: string) {
    openFailed = !(await openUrl(url))
  }

  // A refusal or an expired code: focus the way on, so the message is heard where the user is.
  $effect(() => {
    if (device?.phase === 'denied' || device?.phase === 'expired') retryButton?.focus()
  })
</script>

<div class="device-sign-in">
  {#if waiting !== null}
    <section class="waiting" aria-labelledby={titleId}>
      <h4 class="title" id={titleId}>{m.account_device_title()}</h4>
      <p class="secondary" id={stepsId}>{m.account_device_steps()}</p>
      <p class="code" data-testid="device-user-code">
        <span aria-hidden="true">{code}</span>
        <span class="visually-hidden" id={spokenCodeId}>
          {m.account_device_code()}
          {spellUserCode(code)}
        </span>
      </p>
      <div class="address-block">
        <p class="secondary">{m.account_device_address()}</p>
        <p class="address" data-testid="device-address">{address}</p>
      </div>
      <p class="failure" role="alert">{openFailed ? m.account_device_open_failed() : ''}</p>
      <div class="actions">
        <Button
          label={m.account_device_open()}
          icon={openIcon}
          aria-describedby={`${stepsId} ${spokenCodeId}`}
          bind:element={openButton}
          onclick={() => {
            void open(waiting.verificationUrl)
          }}
        />
        <Button
          variant="tonal"
          label={m.account_device_copy()}
          icon={copyIcon}
          onclick={() => {
            void copy()
          }}
        />
        <Button
          variant="text"
          label={m.common_cancel()}
          onclick={() => {
            void cancel()
          }}
        />
      </div>
      <p class={['status', { retrying: waiting.retrying }]} role="status">
        <span class="spinner" aria-hidden="true"></span>
        {waiting.retrying ? m.account_device_retrying() : m.account_device_waiting()}
      </p>
      <p class="secondary">{m.account_device_expires_at({ time: expiresAt })}</p>
      <p class="secondary" role="status">{copied}</p>
    </section>
  {:else if device?.phase === 'denied' || device?.phase === 'expired'}
    <div class="ended">
      <p class="failure" role="alert">
        {device.phase === 'denied' ? m.account_device_denied() : m.account_device_expired()}
      </p>
      <div class="actions">
        <Button
          label={m.account_device_retry()}
          bind:element={retryButton}
          onclick={() => {
            void start()
          }}
        />
        <Button
          variant="text"
          label={m.common_cancel()}
          onclick={() => {
            void cancel()
          }}
        />
      </div>
    </div>
  {:else}
    <div class="start">
      <Button
        label={requesting ? m.account_device_requesting() : m.account_device_sign_in()}
        icon={openIcon}
        aria-busy={requesting}
        aria-describedby={descriptionId}
        bind:element={startButton}
        onclick={() => {
          void start()
        }}
      />
      <p class="secondary" id={descriptionId}>{m.account_device_description()}</p>
    </div>
    <p class="failure" role="alert">{failure}</p>
  {/if}
</div>

{#snippet openIcon()}
  <Glyph name="open_in_new" />
{/snippet}

{#snippet copyIcon()}
  <Glyph name="content_copy" />
{/snippet}

<style>
  p {
    margin: 0;
  }

  .device-sign-in,
  .waiting,
  .ended,
  .start {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .start {
    align-items: flex-start;
    gap: var(--space-2);
  }

  .waiting {
    padding: var(--space-4);
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-medium, 12px);
  }

  .title {
    margin: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5rem;
  }

  .secondary {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  /* The code, large and spaced, in the digits' font: easy to compare with the browser's. */
  .code {
    color: var(--md-sys-color-on-surface);
    font-family: var(--font-digits, var(--font-ui));
    font-size: 2rem;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    line-height: 2.5rem;
    letter-spacing: 0.12em;
    white-space: nowrap;
    user-select: all;
    direction: ltr;
    unicode-bidi: isolate;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .address-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  /* The page's address, selected whole with one click, to type or paste elsewhere. */
  .address {
    color: var(--md-sys-color-on-surface);
    font-size: 0.875rem;
    line-height: 1.25rem;
    overflow-wrap: anywhere;
    user-select: all;
    direction: ltr;
    unicode-bidi: isolate;
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--md-sys-color-on-surface);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .status.retrying {
    color: var(--md-sys-color-error);
  }

  /* A small indeterminate spinner: a quarter-open ring that turns (still with reduced motion). */
  .spinner {
    flex: none;
    inline-size: 1rem;
    block-size: 1rem;
    border: 2px solid currentColor;
    border-inline-end-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation: none;
    }
  }

  .failure {
    color: var(--md-sys-color-error);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  /* The alert stays in the page while empty, so its text is announced when it appears. */
  .failure:empty {
    margin-block-start: calc(var(--space-3) * -1);
  }

  @media (forced-colors: active) {
    .waiting {
      border-color: CanvasText;
    }

    /* Forced colors paint the open quarter too, so it would read as an empty radio button. */
    .spinner {
      display: none;
    }
  }
</style>
