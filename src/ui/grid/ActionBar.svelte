<!--
  @component
  The floating action bar at the bottom right (spec › Layout, as in Windows Clock): settings (⚙),
  edit mode, "+ Timer" (a menu with the default timer and the presets) and "+ Stopwatch". On narrow
  screens the labels collapse to icons.
-->
<script lang="ts">
  import { MediaQuery } from 'svelte/reactivity'

  import { m } from '../../i18n'
  import { cardStore } from '../../state/cards.svelte'
  import { Button, Icon, IconButton } from '../primitives'
  import TimerMenu from './TimerMenu.svelte'

  interface Props {
    /** Whether edit mode is on. */
    editing: boolean
    ontoggleedit: () => void
    /** Opens the settings dialog. */
    onopensettings: () => void
    /** Whether the "+ Timer" menu is open. Bindable (the Presets shortcut opens it). */
    menuOpen?: boolean
  }

  let { editing, ontoggleedit, onopensettings, menuOpen = $bindable(false) }: Props = $props()

  const narrow = new MediaQuery('max-width: 37.5rem')
  const compact = $derived(narrow.current)
</script>

{#snippet compactIcon()}
  <span class="combo"><Icon name="add" /><Icon name="timer" /></span>
{/snippet}

<div class="action-bar" role="group" aria-label={m.action_bar_label()}>
  <IconButton icon="settings" label={m.action_bar_settings()} onclick={onopensettings} />
  <IconButton
    icon={editing ? 'done' : 'edit'}
    label={m.action_bar_edit()}
    pressed={editing}
    onclick={ontoggleedit}
  />
  <TimerMenu bind:open={menuOpen} {compact} />
  <Button
    variant="text"
    label={compact ? m.action_bar_new_stopwatch() : m.action_bar_stopwatch()}
    aria-label={compact ? undefined : m.action_bar_new_stopwatch()}
    hideLabel={compact}
    icon={compact ? compactIcon : 'add'}
    onclick={() => {
      cardStore.addStopwatch()
    }}
  />
</div>

<style>
  .action-bar {
    position: fixed;
    inset-block-end: max(var(--space-4, 1rem), env(safe-area-inset-bottom));
    inset-inline-end: max(var(--space-4, 1rem), env(safe-area-inset-right));
    z-index: 5;
    display: flex;
    align-items: center;
    gap: var(--space-1, 0.25rem);
    padding: var(--space-1, 0.25rem);
    border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 55%, transparent);
    border-radius: var(--radius-pill, 999px);
    /* The cards' surface, as in Windows Clock. */
    background: var(--card-surface, var(--md-sys-color-surface-container-high));
    box-shadow: var(--shadow-2);
    --icon-button-color: var(--md-sys-color-on-surface-variant);
  }

  .combo {
    display: inline-flex;
    align-items: center;
    gap: 0.05em;
  }

  @media (forced-colors: active) {
    .action-bar {
      border-color: CanvasText;
    }
  }
</style>
