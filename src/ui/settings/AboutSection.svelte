<!--
  @component
  Settings › About: the app's name and icon, its version, the platform it runs on, a link to the
  source code, the license and the privacy policy. On desktop it also has the updates row: "Check
  for updates", then "Checking for updates…", "No updates found", "Couldn't check for updates"
  (with "Check again"), or "Update 1.2.0 available" with "Install and restart" (then the
  download's progress); a build without the updater's key says "Updates aren't set up in this
  build". It shares its state and wording with the update prompt (`desktopUpdates`,
  `updateStatusText`). The row's button stays put while a check or an install runs (it reads as
  unavailable and does nothing), so the focus never drops out of the dialog. Links open in the
  system browser there.

  ```svelte
  <AboutSection version={__APP_VERSION__} platformKind="web" />
  ```
-->
<script lang="ts">
  import { localeState, m } from '../../i18n'
  import type { PlatformKind } from '../../platform'
  import { desktopUpdates, type DesktopUpdates } from '../../pwa.svelte'
  import { externalLinkClick } from '../account/links'
  import { PRIVACY_POLICY_URL } from '../account/privacy'
  import Button from '../primitives/Button.svelte'
  import { updateStatusText } from '../update-status'
  import Glyph from './Glyph.svelte'
  import SectionHeader from './SectionHeader.svelte'

  interface Props {
    /** The app version (package.json's, inlined at build time). */
    version: string
    platformKind: PlatformKind
    /** The desktop updater's state; the app's by default. */
    updates?: DesktopUpdates | undefined
  }

  let { version, platformKind, updates = desktopUpdates }: Props = $props()

  /** Where the source code lives. */
  const REPOSITORY_URL = 'https://github.com/hotdogee/timer-app'

  const icon = `${import.meta.env.BASE_URL}icon.svg`
  const desktop = $derived(platformKind === 'tauri')
  const showUpdates = $derived(desktop && updates.supported)
  const sourceClick = $derived(externalLinkClick(REPOSITORY_URL, desktop))
  const privacyClick = $derived(externalLinkClick(PRIVACY_POLICY_URL, desktop))

  // Whether this build can update itself shows at once, not after the first check.
  $effect(() => {
    if (showUpdates) void updates.init()
  })

  const phase = $derived(updates.phase)
  const status = $derived(updateStatusText(updates, localeState.current))

  /** The row's button. */
  interface UpdateAction {
    readonly label: string
    readonly filled: boolean
    /** What it does, or null while a check or an install runs (it reads as unavailable). */
    readonly run: (() => Promise<void>) | null
  }

  /** The row's button: check, install or try again; unavailable while busy; none unconfigured. */
  const action = $derived.by((): UpdateAction | null => {
    switch (phase) {
      case 'idle':
      case 'none':
      case 'offline':
        return { label: m.about_update_check(), filled: false, run: () => updates.check() }
      case 'check-failed':
        return { label: m.about_update_check_again(), filled: false, run: () => updates.check() }
      case 'checking':
        return { label: m.about_update_check(), filled: false, run: null }
      case 'available':
        return { label: m.about_update_install(), filled: true, run: () => updates.install() }
      case 'failed':
        return { label: m.about_update_try_again(), filled: true, run: () => updates.install() }
      case 'downloading':
      case 'installing':
      case 'restarting':
        return { label: m.about_update_install(), filled: true, run: null }
      case 'unconfigured':
        return null
    }
  })
</script>

<SectionHeader title={m.settings_section_about()} />

<div class="app">
  <img class="icon" src={icon} alt="" width="64" height="64" />
  <div>
    <p class="name">{m.app_name()}</p>
    <p class="secondary">{m.about_version({ version })}</p>
    <p class="secondary">{m.app_description()}</p>
  </div>
</div>

<dl class="facts">
  <div class="fact">
    <dt>{m.about_platform()}</dt>
    <dd>{platformKind === 'tauri' ? m.about_platform_tauri() : m.about_platform_web()}</dd>
  </div>
  <div class="fact">
    <dt>{m.about_source()}</dt>
    <dd>
      <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" onclick={sourceClick}>
        {REPOSITORY_URL.replace(/^https:\/\//, '')}
        <span class="external"><Glyph name="open_in_new" /></span>
      </a>
    </dd>
  </div>
</dl>

{#if showUpdates}
  <div class="updates" data-update-phase={phase}>
    <div class="updates-text">
      <p class="label">{m.about_updates()}</p>
      <p
        class={['secondary', { failure: phase === 'failed' || phase === 'check-failed' }]}
        role="status"
      >
        {status}
      </p>
    </div>
    {#if action !== null}
      {@const { label, filled, run } = action}
      <Button
        variant={filled ? 'filled' : 'tonal'}
        {label}
        icon={updateIcon}
        aria-disabled={run === null ? 'true' : undefined}
        onclick={() => {
          if (run !== null) void run()
        }}
      />
    {/if}
  </div>
{/if}

<p class="license">{m.about_license()}</p>

<p class="privacy">
  <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" onclick={privacyClick}>
    {m.about_privacy()}
    <span class="external"><Glyph name="open_in_new" /></span>
  </a>
</p>

{#snippet updateIcon()}
  <Glyph name="update" />
{/snippet}

<style>
  .app {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding-block: var(--space-3) var(--space-4);
  }

  .icon {
    flex: none;
    inline-size: 4rem;
    block-size: 4rem;
    border-radius: 22%;
  }

  p {
    margin: 0;
  }

  .name {
    color: var(--md-sys-color-on-surface);
    font-size: 1.375rem;
    line-height: 1.75rem;
  }

  .secondary {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .facts {
    margin: 0;
  }

  .fact {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-1) var(--space-5);
    min-block-size: 3.5rem;
    padding-block: var(--space-2);
  }

  dt {
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    line-height: 1.5rem;
  }

  dd {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  a {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-block-size: var(--touch-target, 44px);
    color: var(--md-sys-color-primary);
    font-weight: 500;
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  .external {
    display: inline-flex;
    font-size: 1rem;
  }

  /* The same size as the link above it and as Account's link to the same policy. */
  .privacy {
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  /* A row like a setting's: "Updates" and the state, the button at the end (under it when narrow). */
  .updates {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-5);
    min-block-size: 3.5rem;
    padding-block: var(--space-2);
  }

  .updates-text {
    display: flex;
    flex: 1 1 12rem;
    flex-direction: column;
    gap: 0.125rem;
    min-inline-size: 0;
  }

  .label {
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    line-height: 1.5rem;
  }

  .failure {
    color: var(--md-sys-color-error);
  }

  .license {
    padding-block: var(--space-3) var(--space-1);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }
</style>
