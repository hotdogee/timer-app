<!--
  @component
  One setting as a Material 3 list item: the label (and an optional one-line description) at the
  start, the control at the end. The `control` snippet gets the ids that tie the two together:
  give a labelable control (`<input>`, `<select>`, `<button>`) `id={ids.id}`, which the visible
  `<label for>` names, or reference `ids.labelId` with `aria-labelledby` (a radio group); and
  `aria-describedby={ids.descriptionId}`.

  `layout` places the control: `inline` always beside the label (a switch), `wrap` (default)
  beside it when the panel is wide enough and stretched below it when not (sliders, segmented
  buttons, selects), `block` always below it (a group of fields).

  ```svelte
  <SettingRow label="Loop sound" description="Repeat until dismissed" layout="inline">
    {#snippet control(ids)}
      <Switch id={ids.id} aria-describedby={ids.descriptionId} checked={loop} onchange={setLoop} />
    {/snippet}
  </SettingRow>
  ```
-->
<script lang="ts">
  import type { Snippet } from 'svelte'

  import type { ControlIds } from './types'

  interface Props {
    label: string
    description?: string | undefined
    /** Show the description as a warning (error color), such as blocked notifications. */
    warning?: boolean
    layout?: 'inline' | 'wrap' | 'block'
    control: Snippet<[ControlIds]>
  }

  let { label, description, warning = false, layout = 'wrap', control }: Props = $props()

  const uid = $props.id()
  const ids = $derived<ControlIds>({
    id: `${uid}-control`,
    labelId: `${uid}-label`,
    descriptionId: description === undefined ? undefined : `${uid}-description`,
  })
</script>

<div class={['row', layout]}>
  <div class="text">
    <label class="label" id={ids.labelId} for={ids.id}>{label}</label>
    {#if description !== undefined}
      <div class={['description', { warning }]} id={ids.descriptionId}>{description}</div>
    {/if}
  </div>
  <div class="control">
    {@render control(ids)}
  </div>
</div>

<style>
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2) var(--space-5);
    min-block-size: 3.5rem;
    padding-block: var(--space-2);
  }

  .text {
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
    letter-spacing: 0.03125em;
  }

  .description {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    line-height: 1.25rem;
    letter-spacing: 0.0178em;
  }

  .description.warning {
    color: var(--md-sys-color-error);
  }

  .control {
    display: flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-inline-size: 0;
    max-inline-size: 100%;
  }

  .inline {
    flex-wrap: nowrap;
  }

  .inline .text {
    flex-basis: 0;
  }

  .block .control {
    flex-basis: 100%;
  }

  /* A narrow panel stacks the control under its label and lets it fill the line. */
  @container settings-panel (max-width: 30rem) {
    .wrap .control {
      flex-basis: 100%;
    }

    .wrap .control > :global(:first-child) {
      flex: 1 1 auto;
    }
  }
</style>
