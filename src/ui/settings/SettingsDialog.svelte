<!--
  @component
  The settings dialog (spec › Settings): a modal with the sections (Appearance, Behavior, Keyboard,
  Presets, Data, About) in a list beside the content when the window is wide, or in a scrolling
  tab strip above it when not. Every change applies at once, with no Save button; each section
  that holds settings has a Reset. It opens on the last section shown, with focus on that
  section's tab; Esc, the close button, a backdrop click or the settings shortcut (`Mod+,`) again
  close it (a shortcut without Ctrl, Alt or Meta not while a text field has focus), and focus
  returns to whatever opened it.

  The stores are the app's (`settingsStore`, `presetStore` from `src/state`). Export and import
  are the app's to do: `onexport` saves the file (see `downloadExport` in `data-file.ts`), and
  `onimport` gets a validated file's data once the user agreed to replace everything (pass it to
  `app-data`'s `replaceAll`). The modal dialog makes the page inert, so it carries its own copy of
  the app's live region.

  ```svelte
  <SettingsDialog bind:open {settingsStore} {presetStore} cardCount={cardStore.cards.length}
    onexport={exportData} onimport={(data) => appData.replaceAll(data)} />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'
  import { MediaQuery } from 'svelte/reactivity'

  import { keymap, type exportFormat, type settings } from '../../core'
  import { m } from '../../i18n'
  import { platform, type Notifier, type PlatformKind } from '../../platform'
  import { detectKeyPlatform, isTextEntry } from '../../state/keyboard.svelte'
  import type { PresetStore } from '../../state/presets.svelte'
  import type { SettingsStore } from '../../state/settings.svelte'
  import Announcer from '../Announcer.svelte'
  import Dialog from '../primitives/Dialog.svelte'
  import IconButton from '../primitives/IconButton.svelte'
  import AboutSection from './AboutSection.svelte'
  import AppearanceSection from './AppearanceSection.svelte'
  import BehaviorSection from './BehaviorSection.svelte'
  import DataSection from './DataSection.svelte'
  import KeyboardSection from './KeyboardSection.svelte'
  import PresetsSection from './PresetsSection.svelte'
  import { tabId, type SectionId } from './sections'
  import SettingsNav from './SettingsNav.svelte'
  import { APP_VERSION } from './values'

  interface Props {
    /** Whether the dialog is shown. Bindable; it sets this to false when it closes. */
    open?: boolean
    /** Runs after the dialog closes, however it was closed. */
    onclose?: () => void
    settingsStore: SettingsStore
    presetStore: PresetStore
    /** How many cards there are now, for the import question. */
    cardCount: number
    /** Saves the export file. */
    onexport: () => void
    /** Replaces cards, presets and settings with a validated import file's data. */
    onimport: (data: exportFormat.ExportData) => void
    /** The section shown. Bindable; kept between openings. */
    section?: SectionId
    /** The modifier convention for shortcuts. */
    keyPlatform?: keymap.Platform
    /** The shell, for About. */
    platformKind?: PlatformKind
    /** The app version, for About. */
    version?: string
    /** Notification permission, for Behavior's switch. */
    notifier?: Pick<Notifier, 'permission' | 'request'>
    /** Plays a sound once, for Behavior's Preview. */
    previewSound?: (sound: settings.SoundId, volume: number) => void
  }

  let {
    open = $bindable(false),
    onclose,
    settingsStore,
    presetStore,
    cardCount,
    onexport,
    onimport,
    section = $bindable('appearance'),
    keyPlatform = detectKeyPlatform(),
    platformKind = platform.kind,
    version = APP_VERSION,
    notifier = platform.notifications,
    previewSound = (sound, volume) => {
      platform.audio.preview(sound, volume)
    },
  }: Props = $props()

  const uid = $props.id()
  const titleId = `${uid}-title`
  const panelId = `${uid}-panel`

  /** The width from which the dialog (56rem at most, 1rem from each edge) shows a side list. */
  const WIDE_QUERY = 'min-width: 42rem'
  const wideQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? new MediaQuery(WIDE_QUERY)
      : null
  const wide = $derived(wideQuery?.current ?? true)

  let dialog = $state<HTMLDialogElement>()
  let panel = $state<HTMLElement>()

  // Each opening starts with focus on the current section's tab.
  $effect(() => {
    if (!open) return
    void tick().then(() => {
      dialog?.ownerDocument.getElementById(tabId(uid, section))?.focus()
    })
  })

  /**
   * Closes the native dialog at once, so focus is back on the opener even when the app unmounts
   * this component as soon as `open` turns false.
   */
  function close() {
    if (dialog?.open) dialog.close()
    open = false
  }

  function showSection() {
    if (panel) panel.scrollTop = 0
  }

  function handleKeydown(event: KeyboardEvent) {
    // Not once the dialog has closed: a key pressed then (Mod+, to open it again) is the page's.
    if (event.defaultPrevented || event.isComposing || dialog?.open !== true) return
    // Only keys from this dialog itself, not from one opened inside it.
    const target = event.target instanceof Element ? event.target.closest('dialog') : null
    if (target !== dialog) return
    // A shortcut without Ctrl, Alt or Meta is typing while a text field has focus.
    const typing = !event.ctrlKey && !event.altKey && !event.metaKey
    if (typing && isTextEntry(event.target)) return
    const pressed = keymap.keyEventForMatching(event)
    if (keymap.resolveAction(settingsStore.bindings, pressed, keyPlatform) !== 'settings') return
    // The settings shortcut toggles the dialog, as the palette's toggles the palette.
    event.preventDefault()
    close()
  }
</script>

<Dialog
  bind:open
  bind:element={dialog}
  aria-labelledby={titleId}
  class="settings-dialog"
  style="--dialog-width: 56rem; --dialog-padding: 0"
  onclose={() => onclose?.()}
  onkeydown={handleKeydown}
>
  {#if open}
    <div class={['settings', wide ? 'wide' : 'narrow']}>
      <header class="header">
        <h2 id={titleId}>{m.settings_title()}</h2>
        <IconButton icon="close" label={m.common_close()} onclick={close} />
      </header>
      <nav class="sections">
        <SettingsNav
          bind:current={section}
          idPrefix={uid}
          {panelId}
          orientation={wide ? 'vertical' : 'horizontal'}
          onchange={showSection}
        />
      </nav>
      <div
        bind:this={panel}
        class="panel"
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(uid, section)}
      >
        {#if section === 'appearance'}
          <AppearanceSection {settingsStore} />
        {:else if section === 'behavior'}
          <BehaviorSection {settingsStore} {notifier} {previewSound} />
        {:else if section === 'keyboard'}
          <KeyboardSection {settingsStore} platform={keyPlatform} />
        {:else if section === 'presets'}
          <PresetsSection {presetStore} timeStyle={settingsStore.synced.timeStyle} />
        {:else if section === 'data'}
          <DataSection {cardCount} presetCount={presetStore.presets.length} {onexport} {onimport} />
        {:else}
          <AboutSection {version} {platformKind} />
        {/if}
      </div>
    </div>
  {/if}
  <Announcer />
</Dialog>

<style>
  .settings {
    /* One height for every field and menu in the dialog, and tonal buttons that stand out from
       its surface (the cards' tonal color is meant for the card). */
    --text-field-height: 2.75rem;
    --select-height: 2.75rem;
    --button-tonal-container: var(--md-sys-color-secondary-container);
    --button-tonal-content: var(--md-sys-color-on-secondary-container);
    display: grid;
    block-size: min(44rem, calc(100dvh - 2rem));
  }

  .wide {
    grid-template-areas:
      'header header'
      'sections panel';
    grid-template-columns: 15rem minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  .narrow {
    grid-template-areas:
      'header'
      'sections'
      'panel';
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr);
  }

  .header {
    display: flex;
    grid-area: header;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding-block: var(--space-4) var(--space-2);
    padding-inline: var(--space-5) var(--space-3);
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 2rem;
  }

  .sections {
    grid-area: sections;
    min-inline-size: 0;
  }

  /* Material 3 navigation drawer items sit 12px in from both sides. */
  .wide .sections {
    padding-block: var(--space-2) var(--space-4);
    padding-inline: var(--space-3);
    overflow-y: auto;
  }

  .panel {
    container: settings-panel / inline-size;
    grid-area: panel;
    min-block-size: 0;
    padding-block: var(--space-2) var(--space-6);
    padding-inline: var(--space-5);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .narrow .header {
    padding-inline: var(--space-4) var(--space-2);
  }

  .narrow .panel {
    padding-block-start: var(--space-3);
    padding-inline: var(--space-4);
  }

  /* Narrow: the selected tab already names the section, so its heading is for screen readers
     only, and a Reset keeps a short row of its own at the end. */
  .narrow .panel :global(.section-heading) {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .narrow .panel :global(.section-title-row) {
    min-block-size: 0;
    justify-content: flex-end;
  }
</style>
