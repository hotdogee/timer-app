<!--
  @component
  Settings › Keyboard: every rebindable action, grouped like the cheat sheet, with its keys as key
  caps (each with a remove button). The edit button opens a recorder for the next key press:
  digits, Backspace and bare modifiers are refused, a key another action uses asks whether to move
  it here, and anything else becomes the action's shortcut at once. Reset gives one action its
  default back, and the section's Reset all gives every action its default; each change is
  announced. A key that several actions have already (from an import, or recorded on another
  platform) is flagged on each of their rows. The mini window's shortcut is listed only where there
  is a mini window (`miniWindow`, the platform's by default). In the desktop app (`desktop`) the
  description points to Settings › Desktop for the global shortcuts.

  ```svelte
  <KeyboardSection {settingsStore} platform="other" />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import { keymap } from '../../core'
  import { localeState, m } from '../../i18n'
  import { actionName } from '../../i18n/labels'
  import { platform as appPlatform } from '../../platform'
  import type { SettingsStore } from '../../state/settings.svelte'
  import { announce } from '../announce.svelte'
  import KeyLabel from '../KeyLabel.svelte'
  import Button from '../primitives/Button.svelte'
  import IconButton from '../primitives/IconButton.svelte'
  import Icon from '../primitives/Icon.svelte'
  import Glyph from './Glyph.svelte'
  import {
    HIDDEN_ACTIONS,
    boundKeys,
    classifyRecording,
    isCustomized,
    sharedShortcuts,
    shortcutGroups,
    withDefaultShortcut,
    withShortcut,
    withoutShortcut,
    type BoundKey,
  } from './rebinding'
  import SectionHeader from './SectionHeader.svelte'
  import ShortcutRecorder from './ShortcutRecorder.svelte'

  interface Props {
    settingsStore: SettingsStore
    /** The modifier convention for key labels and recording (`Mod` is Cmd on `'mac'`). */
    platform: keymap.Platform
    /** Whether there is a mini window to list the shortcut of. */
    miniWindow?: boolean
    /** The desktop app, whose global shortcuts are in Settings › Desktop. */
    desktop?: boolean
  }

  let {
    settingsStore,
    platform,
    miniWindow = appPlatform.windows.supported,
    desktop = appPlatform.kind === 'tauri',
  }: Props = $props()

  const uid = $props.id()

  /** The action whose recorder is open, and what was wrong with its last key press. */
  let recording = $state<keymap.ActionId | null>(null)
  let recordError = $state<string | undefined>(undefined)
  /** A recorded key that other actions use, waiting for "Move here" or Cancel. */
  let conflict = $state<{
    action: keymap.ActionId
    text: string
    label: string
    owners: readonly keymap.ActionId[]
    moveFrom: readonly keymap.ActionId[]
  } | null>(null)

  let root = $state<HTMLElement>()

  /** Actions not listed here: the mini window's where there is none. */
  const hidden = $derived(miniWindow ? [] : HIDDEN_ACTIONS)
  const groups = $derived(shortcutGroups(hidden))
  const overrides = $derived(settingsStore.synced.keymap)
  const bindings = $derived(settingsStore.bindings)
  /**
   * Keys that several actions have, as an import or settings recorded on another platform can
   * leave them (only the first action gets the key): each such row says so.
   */
  const shared = $derived(sharedShortcuts(bindings, platform, hidden))

  function rowId(action: keymap.ActionId): string {
    return `${uid}-${action}`
  }

  /** Focuses a control of `action`'s row once the row has re-rendered. */
  function focusRow(action: keymap.ActionId, part: 'change' | 'move' = 'change') {
    void tick().then(() => {
      root?.querySelector<HTMLElement>(`[data-action="${action}"] [data-part="${part}"]`)?.focus()
    })
  }

  function save(next: typeof overrides) {
    settingsStore.updateSynced({ keymap: next })
  }

  /** Key labels as one list in the UI language ("Ctrl+K, Ctrl+P"), or "None". */
  function keyList(keys: readonly BoundKey[]): string {
    if (keys.length === 0) return m.shortcut_none()
    const labels = keys.map((key) => key.label)
    return new Intl.ListFormat(localeState.current, { style: 'short', type: 'unit' }).format(labels)
  }

  function startRecording(action: keymap.ActionId) {
    conflict = null
    recordError = undefined
    recording = action
  }

  function stopRecording(action: keymap.ActionId, reason: 'escape' | 'blur') {
    if (recording !== action) return
    recording = null
    recordError = undefined
    if (reason === 'escape') focusRow(action)
  }

  function record(action: keymap.ActionId, combo: keymap.KeyCombo) {
    const result = classifyRecording(bindings, action, combo, platform, hidden)
    if (result.kind === 'reserved') {
      recordError = m.shortcut_reserved({ key: result.label })
      return
    }
    recording = null
    recordError = undefined
    if (result.kind === 'conflict') {
      const { text, label, owners, moveFrom } = result
      conflict = { action, text, label, owners, moveFrom }
      focusRow(action, 'move')
      return
    }
    save(withShortcut(overrides, action, result.text, platform, result.moveFrom))
    announce(m.shortcut_set({ action: actionName(action), key: result.label }))
    focusRow(action)
  }

  function moveHere() {
    if (conflict === null) return
    const { action, text, label, moveFrom } = conflict
    conflict = null
    save(withShortcut(overrides, action, text, platform, moveFrom))
    announce(m.shortcut_set({ action: actionName(action), key: label }))
    focusRow(action)
  }

  function keepConflict() {
    if (conflict === null) return
    const { action } = conflict
    conflict = null
    focusRow(action)
  }

  function remove(action: keymap.ActionId, key: BoundKey) {
    save(withoutShortcut(overrides, action, key.text, platform))
    announce(m.shortcut_removed({ key: key.label, action: actionName(action) }))
    focusRow(action)
  }

  function reset(action: keymap.ActionId) {
    save(withDefaultShortcut(overrides, action))
    const keys = boundKeys(keymap.DEFAULT_BINDINGS, action, platform)
    announce(m.shortcut_reset_done({ action: actionName(action), key: keyList(keys) }))
    focusRow(action)
  }

  function resetAll() {
    recording = null
    conflict = null
    settingsStore.resetKeymap()
    announce(m.shortcut_reset_all_done())
  }
</script>

<div class="keyboard" bind:this={root}>
  <!-- The button's name starts with its visible "Reset all", as speech input needs. -->
  <SectionHeader
    title={m.settings_section_keyboard()}
    description={desktop
      ? m.settings_keyboard_description_desktop()
      : m.settings_keyboard_description()}
    resetLabel={m.shortcut_reset_all()}
    resetName={m.shortcut_reset_all_label()}
    onreset={resetAll}
  />
  {#each groups as group, g (g)}
    <section class="group" aria-labelledby={`${uid}-group-${String(g)}`}>
      <h4 id={`${uid}-group-${String(g)}`}>{group.title()}</h4>
      <ul>
        {#each group.actions as action (action)}
          {@const name = actionName(action)}
          {@const keys = boundKeys(bindings, action, platform)}
          {@const customized = isCustomized(overrides, action, platform)}
          {@const sharing = shared.get(action) ?? []}
          {@const asking = conflict?.action === action}
          {@const sharedId = `${rowId(action)}-shared`}
          <li class={['shortcut', { asking }]} data-action={action}>
            <div class="main">
              <span class="name" id={rowId(action)}>{name}</span>
              <div class="keys">
                {#if recording === action}
                  <ShortcutRecorder
                    actionName={name}
                    {platform}
                    error={recordError}
                    onrecord={(combo: keymap.KeyCombo) => {
                      record(action, combo)
                    }}
                    oncancel={(reason: 'escape' | 'blur') => {
                      stopRecording(action, reason)
                    }}
                  />
                {:else if conflict !== null && conflict.action === action}
                  <!-- Esc anywhere in the question cancels the move instead of closing the dialog. -->
                  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                  <div
                    class="conflict"
                    role="group"
                    aria-labelledby={`${rowId(action)}-conflict`}
                    onkeydown={(event) => {
                      if (event.key !== 'Escape') return
                      event.preventDefault()
                      event.stopPropagation()
                      keepConflict()
                    }}
                  >
                    <p id={`${rowId(action)}-conflict`}>
                      {m.shortcut_conflict({
                        key: conflict.label,
                        action: actionName(conflict.owners[0] ?? action),
                      })}
                    </p>
                    <div class="conflict-actions">
                      <Button variant="text" label={m.common_cancel()} onclick={keepConflict} />
                      <Button
                        variant="tonal"
                        label={m.shortcut_conflict_move()}
                        data-part="move"
                        onclick={moveHere}
                      />
                    </div>
                  </div>
                {:else}
                  {#each keys as key (key.text)}
                    <span class="key">
                      <kbd><KeyLabel label={key.label} /></kbd>
                      <button
                        type="button"
                        class="remove"
                        aria-label={m.shortcut_remove_label({ key: key.label, action: name })}
                        title={m.shortcut_remove_label({ key: key.label, action: name })}
                        onclick={() => {
                          remove(action, key)
                        }}
                      >
                        <Icon name="close" />
                      </button>
                    </span>
                  {:else}
                    <span class="none">{m.shortcut_none()}</span>
                  {/each}
                {/if}
              </div>
            </div>
            {#if recording !== action && !asking}
              <div class="buttons">
                <IconButton
                  icon="restart_alt"
                  label={m.shortcut_reset_label({ action: name })}
                  class={customized ? undefined : 'unchanged'}
                  onclick={() => {
                    reset(action)
                  }}
                />
                <IconButton
                  icon="edit"
                  label={m.shortcut_change_label({ action: name })}
                  data-part="change"
                  aria-describedby={sharing.length > 0 ? sharedId : undefined}
                  onclick={() => {
                    startRecording(action)
                  }}
                />
              </div>
            {/if}
            {#if sharing.length > 0 && !asking}
              <p class="shared" id={sharedId}>
                <Glyph name="warning" />
                <span class="shared-text">
                  {#each sharing as entry (entry.label)}
                    <span>
                      {m.shortcut_shared({
                        key: entry.label,
                        action: actionName(entry.others[0] ?? action),
                      })}
                    </span>
                  {/each}
                </span>
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/each}
</div>

<style>
  .group {
    margin-block-start: var(--space-4);
  }

  h4 {
    margin: 0 0 var(--space-1);
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.00714em;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  /* A Material 3 list item: the name and its keys, then the row's buttons; a warning under them. */
  .shortcut {
    display: grid;
    grid-template-areas: 'main buttons' 'shared shared';
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-3);
    min-block-size: 3.5rem;
    padding-block: var(--space-1);
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
  }

  /* Recording or asking: no buttons, so no column (or gap) for them. */
  .shortcut:not(:has(> .buttons)) {
    grid-template-areas: 'main' 'shared';
    grid-template-columns: minmax(0, 1fr);
  }

  .shortcut:last-child {
    border-block-end: none;
  }

  /*
   * The keys follow the name on its line while they fit and wrap under it when they don't, as on
   * a narrow dialog: the name grows to push them to the end of the line.
   */
  .main {
    display: flex;
    grid-area: main;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-3);
    min-inline-size: 0;
  }

  .name {
    flex: 1 1 auto;
    min-inline-size: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 1rem;
    line-height: 1.5rem;
  }

  .keys {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
  }

  /* The move question needs the whole width: it goes under the action's name. */
  .asking .keys {
    flex-basis: 100%;
    padding-block-end: var(--space-1);
  }

  .buttons {
    display: flex;
    grid-area: buttons;
    margin-inline-end: calc(-1 * var(--space-2));
  }

  /* An action at its default has nothing to reset: keep the space, hide the button. */
  .buttons :global(.unchanged) {
    visibility: hidden;
  }

  .key {
    display: inline-flex;
    align-items: center;
    block-size: 2rem;
    padding-inline: 0.625rem 0.125rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-small, 8px);
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface);
  }

  kbd {
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    line-height: 1.25rem;
    white-space: nowrap;
  }

  .remove {
    position: relative;
    display: inline-grid;
    place-items: center;
    inline-size: 1.75rem;
    block-size: 1.75rem;
    margin-inline-start: 0.125rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 50%;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 1.125rem;
    cursor: pointer;
  }

  /* Invisible hit-area extension up to the touch target. */
  .remove::after {
    content: '';
    position: absolute;
    inset: min(0px, calc((100% - var(--touch-target, 44px)) / 2));
  }

  .remove::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
  }

  .remove:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .remove:focus-visible::before,
  .remove:active::before {
    opacity: var(--state-focus, 0.1);
  }

  /* Set apart by color only: CJK fonts have no italics, and a slanted 無 or なし looks broken. */
  .none {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
  }

  .conflict {
    display: flex;
    flex: 1 1 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1) var(--space-2);
  }

  .conflict p {
    margin: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .conflict-actions {
    display: flex;
    gap: var(--space-1);
  }

  .shared {
    display: flex;
    grid-area: shared;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0 0 var(--space-1);
    color: var(--md-sys-color-error);
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .shared :global(.glyph) {
    font-size: 1rem;
  }

  .shared-text {
    display: flex;
    flex-direction: column;
  }

  /* Narrow: the question starts under the name, like the keys do. */
  @container settings-panel (max-width: 30rem) {
    .conflict {
      justify-content: flex-start;
    }
  }

  @media (forced-colors: active) {
    .key {
      border-color: CanvasText;
    }

    .remove::before {
      display: none;
    }

    .shared {
      color: CanvasText;
    }
  }
</style>
