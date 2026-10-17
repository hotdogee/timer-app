<!--
  @component
  The heading of a settings section: its title, an optional Reset button at the end (visible text
  `resetLabel`, accessible name `resetName`, which must contain the visible text, e.g. "Reset" /
  "Reset Appearance settings"), and an optional description under it. The narrow settings dialog
  hides the title visually (`section-heading`), since the selected tab shows it.

  ```svelte
  <SectionHeader title="Appearance" resetLabel="Reset" resetName="Reset Appearance settings"
    onreset={() => settingsStore.resetDevice()} />
  ```
-->
<script lang="ts">
  import Button from '../primitives/Button.svelte'

  interface Props {
    title: string
    description?: string | undefined
    resetLabel?: string | undefined
    resetName?: string | undefined
    onreset?: (() => void) | undefined
  }

  let { title, description, resetLabel, resetName, onreset }: Props = $props()
</script>

<div class="header">
  <div class="title-row section-title-row">
    <h3 class="section-heading">{title}</h3>
    {#if onreset !== undefined && resetLabel !== undefined}
      <Button
        variant="text"
        icon="restart_alt"
        label={resetLabel}
        aria-label={resetName}
        onclick={onreset}
      />
    {/if}
  </div>
  {#if description !== undefined}
    <p class="description">{description}</p>
  {/if}
</div>

<style>
  .header {
    margin-block-end: var(--space-2);
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-block-size: var(--touch-target, 44px);
  }

  h3 {
    margin: 0;
    color: var(--md-sys-color-on-surface);
    font-size: 1.375rem;
    font-weight: 400;
    line-height: 1.75rem;
  }

  .description {
    margin-block: var(--space-1) 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
  }
</style>
