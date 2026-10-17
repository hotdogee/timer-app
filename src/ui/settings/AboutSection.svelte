<!--
  @component
  Settings › About: the app's name and icon, its version, the platform it runs on, a link to the
  source code and the license.

  ```svelte
  <AboutSection version={__APP_VERSION__} platformKind="web" />
  ```
-->
<script lang="ts">
  import { m } from '../../i18n'
  import type { PlatformKind } from '../../platform'
  import Glyph from './Glyph.svelte'
  import SectionHeader from './SectionHeader.svelte'

  interface Props {
    /** The app version (package.json's, inlined at build time). */
    version: string
    platformKind: PlatformKind
  }

  let { version, platformKind }: Props = $props()

  /** Where the source code lives. */
  const REPOSITORY_URL = 'https://github.com/hotdogee/timer-app'

  const icon = `${import.meta.env.BASE_URL}icon.svg`
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
      <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
        {REPOSITORY_URL.replace(/^https:\/\//, '')}
        <span class="external"><Glyph name="open_in_new" /></span>
      </a>
    </dd>
  </div>
</dl>

<p class="license">{m.about_license()}</p>

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

  .license {
    padding-block: var(--space-3);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }
</style>
