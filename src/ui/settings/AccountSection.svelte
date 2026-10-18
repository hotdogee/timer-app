<!--
  @component
  Settings › Account (spec › Settings, plan › Account UI). Accounts are optional: signed out, it
  offers sign-in to sync ("Sign in to sync your cards across devices") with an emailed code or an
  OAuth provider the server has. Signed in, it shows who (name, email, picture), the sync status
  ("Synced just now", "Connecting…", "Offline. Changes sync when you're back.", "Not syncing"),
  "Sync this device" (on unless turned off here; off, the device stays signed in without
  syncing), "Download server copy", "Sign out", and "Delete account…", which asks first
  (`DeleteAccountDialog`). Signing out and deleting keep the cards on this device; the section then
  offers sign-in again, with focus in its email field. After signing in, focus moves to the
  signed-in summary. A server copy refused for want of a session (signed out elsewhere) says so
  and has the session checked again, which shows the sign-in form when it is gone.

  While the session is unknown it says "Checking your account…", for a few seconds at most (then
  the server is out of reach, and the sign-in form shows; trying it says so).

  On desktop (`desktop`, the Tauri app) signing in goes through the browser first
  (`DeviceSignIn`: a code to approve on the `/device` page; providers refuse embedded webviews, so
  their buttons are hidden), with the emailed code below it; once the code is approved, focus
  moves to the signed-in summary as after the emailed code. Links open in the system browser.

  `auth` is the app's auth state (`authStore`), `sync` the sync controller (`remoteSync`; null when
  there is none), `syncPreference` this device's sync switch (null hides it). `now` is the app
  clock, for "Synced 5 minutes ago".

  ```svelte
  <AccountSection {auth} sync={{ status: remoteSync.status, lastSyncAt: remoteSync.lastSyncAt }} />
  ```
-->
<script lang="ts">
  import { untrack } from 'svelte'

  import type { Clock } from '../../core'
  import { localeState, m } from '../../i18n'
  import { platform } from '../../platform'
  import { appClock } from '../../state/app-clock'
  import { bearerToken } from '../../state/auth.svelte'
  import type { SyncPreference } from '../../state/sync-preference.svelte'
  import DeleteAccountDialog from '../account/DeleteAccountDialog.svelte'
  import { authErrorMessage, sentences, serverCopyErrorMessage } from '../account/errors'
  import { checkingPatience } from '../account/checking.svelte'
  import DeviceSignIn from '../account/DeviceSignIn.svelte'
  import { externalLinkClick } from '../account/links'
  import { PRIVACY_POLICY_URL } from '../account/privacy'
  import { ServerCopyError, downloadServerCopy as saveServerCopy } from '../account/server-copy'
  import SignInForm from '../account/SignInForm.svelte'
  import { lastSyncedText, syncIcon, syncStatusText } from '../account/status'
  import type { AccountAuth, SyncInfo } from '../account/types'
  import { announce } from '../announce.svelte'
  import Button from '../primitives/Button.svelte'
  import Switch from '../primitives/Switch.svelte'
  import Glyph from './Glyph.svelte'
  import SectionHeader from './SectionHeader.svelte'
  import SettingRow from './SettingRow.svelte'
  import type { ControlIds } from './types'

  interface Props {
    auth: AccountAuth
    /** The sync connection while signed in; null when there is none. */
    sync?: SyncInfo | null
    /** Whether this device syncs while signed in; null hides the switch. */
    syncPreference?: SyncPreference | null
    /** The app clock, for how long ago the last sync was. */
    now?: Clock
    /** Downloads and saves the server copy; resolves to the file name. */
    downloadServerCopy?: () => Promise<string>
    /** The desktop app: sign in through the browser, no provider buttons. */
    desktop?: boolean
  }

  let {
    auth,
    sync = null,
    syncPreference = null,
    now = appClock,
    downloadServerCopy = () => saveServerCopy({ token: bearerToken() }),
    desktop = platform.kind === 'tauri',
  }: Props = $props()

  /** How often "Synced 5 minutes ago" is brought up to date while the section shows. */
  const REFRESH_MS = 30_000

  let deleteOpen = $state(false)
  let pending = $state<'sign-out' | 'server-copy' | null>(null)
  /** The outcome of the last sign-out or download, under the buttons. */
  let failure = $state('')
  let result = $state('')
  /** Where focus goes when the view changes: the sign-in form after signing out, the summary after
      signing in. */
  let focusSignIn = $state(false)
  let focusSummary = $state(false)

  let reading = $state(untrack(() => now()))
  $effect(() => {
    if (sync === null) return
    // A new status or exchange is read against the time now, not up to half a minute ago.
    void sync.status
    void sync.lastSyncAt
    reading = now()
    const timer = setInterval(() => {
      reading = now()
    }, REFRESH_MS)
    return () => {
      clearInterval(timer)
    }
  })

  /** Past this, an `unknown` session (the server out of reach) shows the sign-in form anyway. */
  const patience = checkingPatience(() => auth.status === 'unknown')
  const checking = $derived(auth.status === 'unknown' && !patience.expired)
  const user = $derived(auth.status === 'signed-in' ? auth.user : null)
  const displayName = $derived(user?.name?.trim() ?? '')
  const initial = $derived(
    ((displayName === '' ? user?.email : displayName) ?? '?').charAt(0).toUpperCase(),
  )
  const status = $derived(sync?.status ?? 'off')
  const lastSyncAt = $derived(sync?.lastSyncAt ?? null)
  const statusText = $derived(syncStatusText(status, lastSyncAt, reading, localeState.current))
  const lastText = $derived(lastSyncedText(status, lastSyncAt, reading, localeState.current))

  /** Focuses `element` when it appears, if `wanted` says so (and then forgets the wish). */
  function focusOnMount(wanted: () => boolean, done: () => void) {
    return (element: HTMLElement) => {
      if (!wanted()) return
      done()
      element.focus()
    }
  }

  async function signOut() {
    if (pending !== null) return
    pending = 'sign-out'
    failure = ''
    result = ''
    const signedOut = await auth.signOut()
    pending = null
    if (!signedOut) {
      failure = authErrorMessage(auth.error ?? 'unknown')
      return
    }
    focusSignIn = true
    // Desktop, with the server out of reach: signed out here; the session there just expires.
    announce(signedOut === 'device-only' ? m.account_signed_out_device() : m.account_signed_out())
  }

  async function saveCopy() {
    if (pending !== null) return
    pending = 'server-copy'
    failure = ''
    result = ''
    try {
      const file = await downloadServerCopy()
      result = m.account_server_copy_done({ file })
    } catch (error) {
      failure = sentences(m.account_server_copy_error(), serverCopyErrorMessage(error))
      // Refused for want of a session: it may have ended elsewhere. If so, this shows sign-in.
      if (error instanceof ServerCopyError && error.status === 401) void auth.refresh?.()
    } finally {
      pending = null
    }
  }

  /**
   * Set while a desktop sign-in through the browser waits for approval, so its success moves focus
   * to the summary and is announced, as the emailed code's is.
   */
  let viaBrowser = false
  $effect(() => {
    if (auth.device?.phase === 'waiting') {
      viaBrowser = true
      return
    }
    if (user === null) {
      viaBrowser = false
      return
    }
    if (!viaBrowser) return
    viaBrowser = false
    focusSummary = true
    const email = user.email
    untrack(() => {
      announce(m.account_signed_in_as({ email }))
    })
  })

  const privacyClick = $derived(externalLinkClick(PRIVACY_POLICY_URL, desktop))

  function deleted() {
    failure = ''
    result = ''
    focusSignIn = true
    announce(m.account_deleted())
  }
</script>

<SectionHeader title={m.settings_section_account()} />

{#if checking}
  <p class="checking" role="status">{m.account_checking()}</p>
{:else if user === null}
  <div class="signed-out">
    <div class="intro">
      <p class="lead">{m.account_intro()}</p>
      <p class="secondary">{m.account_intro_detail()}</p>
    </div>
    {#if desktop}
      <DeviceSignIn {auth} />
    {/if}
    {#if !desktop || auth.device?.phase !== 'waiting'}
      {#if desktop}
        <div class="divider"><span>{m.account_device_email()}</span></div>
      {/if}
      <SignInForm
        {auth}
        autofocus={focusSignIn}
        providers={!desktop}
        onsignedin={() => {
          focusSignIn = false
          focusSummary = true
        }}
      />
    {/if}
    <p class="privacy">
      <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" onclick={privacyClick}>
        {m.account_privacy()}
        <span class="external"><Glyph name="open_in_new" /></span>
      </a>
    </p>
  </div>
{:else}
  <div
    class="profile"
    tabindex="-1"
    {@attach focusOnMount(
      () => focusSummary,
      () => {
        focusSummary = false
      },
    )}
  >
    {#if user.image}
      <img
        class="avatar"
        src={user.image}
        alt=""
        width="48"
        height="48"
        referrerpolicy="no-referrer"
      />
    {:else}
      <span class="avatar initial" aria-hidden="true">{initial}</span>
    {/if}
    <div class="who">
      {#if displayName !== ''}
        <p class="name">{displayName}</p>
      {/if}
      <p class={displayName === '' ? 'name' : 'secondary'}>
        {m.account_signed_in_as({ email: user.email })}
      </p>
    </div>
  </div>

  <div class="sync" data-sync-status={status}>
    <p class="label">{m.account_sync()}</p>
    <p class="secondary status">
      <span class="sync-icon"><Glyph name={syncIcon(status)} /></span>
      {statusText}
    </p>
    {#if lastText !== null}
      <p class="secondary">{lastText}</p>
    {/if}
  </div>

  {#if syncPreference !== null}
    {@const preference = syncPreference}
    <SettingRow label={m.account_sync_device()} description={m.account_sync_device_description()}>
      {#snippet control(ids: ControlIds)}
        <Switch
          id={ids.id}
          aria-describedby={ids.descriptionId}
          checked={preference.enabled}
          onchange={(enabled: boolean) => {
            preference.setEnabled(enabled)
          }}
        />
      {/snippet}
    </SettingRow>
  {/if}

  <SettingRow
    label={m.account_server_copy()}
    description={m.account_server_copy_description()}
    layout="inline"
  >
    {#snippet control(ids: ControlIds)}
      <Button
        variant="tonal"
        id={ids.id}
        label={pending === 'server-copy' ? m.account_downloading() : m.account_download()}
        icon={cloudDownload}
        aria-describedby={ids.descriptionId}
        aria-busy={pending === 'server-copy'}
        onclick={() => {
          void saveCopy()
        }}
      />
    {/snippet}
  </SettingRow>

  <SettingRow
    label={m.account_sign_out()}
    description={m.account_sign_out_description()}
    layout="inline"
  >
    {#snippet control(ids: ControlIds)}
      <Button
        variant="tonal"
        id={ids.id}
        label={pending === 'sign-out' ? m.account_signing_out() : m.account_sign_out()}
        icon={logout}
        aria-describedby={ids.descriptionId}
        aria-busy={pending === 'sign-out'}
        onclick={() => {
          void signOut()
        }}
      />
    {/snippet}
  </SettingRow>

  <div class="danger">
    <SettingRow
      label={m.account_delete()}
      description={m.account_delete_description()}
      layout="inline"
    >
      {#snippet control(ids: ControlIds)}
        <Button
          variant="tonal"
          id={ids.id}
          label={m.account_delete_open()}
          icon="delete"
          aria-describedby={ids.descriptionId}
          aria-haspopup="dialog"
          onclick={() => {
            deleteOpen = true
          }}
        />
      {/snippet}
    </SettingRow>
  </div>

  <div class="feedback">
    <p class="failure" role="alert">{failure}</p>
    <p class="result" role="status">{result}</p>
  </div>

  <DeleteAccountDialog bind:open={deleteOpen} {auth} ondeleted={deleted} />
{/if}

{#snippet cloudDownload()}
  <Glyph name="cloud_download" />
{/snippet}

{#snippet logout()}
  <Glyph name="logout" />
{/snippet}

<style>
  p {
    margin: 0;
  }

  .checking,
  .secondary {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .checking {
    padding-block: var(--space-3);
  }

  .signed-out {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-inline-size: 32rem;
    padding-block: var(--space-2) var(--space-4);
  }

  .intro {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .lead {
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    line-height: 1.5rem;
  }

  /* "or sign in with an emailed code" between two rules (desktop). */
  .divider {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    text-align: center;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    border-block-start: 1px solid var(--md-sys-color-outline-variant);
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

  .profile {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding-block: var(--space-3);
    border-radius: var(--radius-small, 8px);
  }

  .profile:focus {
    outline: none;
  }

  .profile:focus-visible {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 4px;
  }

  .avatar {
    flex: none;
    inline-size: 3rem;
    block-size: 3rem;
    border-radius: 50%;
    object-fit: cover;
  }

  .initial {
    display: inline-grid;
    place-items: center;
    background: var(--md-sys-color-primary-container);
    color: var(--md-sys-color-on-primary-container);
    font-size: 1.25rem;
    font-weight: 500;
  }

  .who {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    min-inline-size: 0;
    overflow-wrap: anywhere;
  }

  /* Breaks only at the spaces around the address (CJK would split 登入 otherwise); the address
     itself still wraps anywhere when it is too long. */
  .who p {
    word-break: keep-all;
  }

  .name {
    color: var(--md-sys-color-on-surface);
    font-size: 1.125rem;
    line-height: 1.5rem;
  }

  .sync {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.125rem;
    min-block-size: 3.5rem;
    padding-block: var(--space-2);
  }

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .sync-icon {
    display: inline-flex;
    flex: none;
    font-size: 1.25rem;
  }

  [data-sync-status='online'] .sync-icon {
    color: var(--md-sys-color-primary);
  }

  .label {
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    line-height: 1.5rem;
    letter-spacing: 0.03125em;
  }

  /* The destructive row's button in the error colors. */
  .danger {
    --button-tonal-container: var(--md-sys-color-error-container);
    --button-tonal-content: var(--md-sys-color-on-error-container);
  }

  .feedback {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-block-start: var(--space-2);
  }

  .failure,
  .result {
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .failure {
    color: var(--md-sys-color-error);
  }

  .result {
    color: var(--md-sys-color-on-surface-variant);
  }

  @media (forced-colors: active) {
    .initial {
      border: 1px solid CanvasText;
    }

    .divider::before,
    .divider::after {
      border-color: CanvasText;
    }
  }
</style>
