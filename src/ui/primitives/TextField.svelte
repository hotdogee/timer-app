<!--
  @component
  A Material 3 outlined text field: a native `<input>` with a label that rests inside the field and
  floats into a notch in the outline when the field is focused or has text, and an optional
  supporting text or error line below. `value` is bindable; every other input attribute and event
  (`oninput`, `onchange`, `onkeydown`, `inputmode`, …) passes through to the `<input>`.

  `label` is always the accessible name; with `hideLabel` it is not shown (a column header says it)
  and becomes `aria-label`. An `error` replaces the supporting text, marks the field invalid and
  is announced politely. Size it with `--text-field-height`.

  ```svelte
  <TextField label="Name" bind:value={name} onchange={commit} />
  <TextField label="Preset name" hideLabel value={preset.name} error={nameError} />
  ```
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'children' | 'size'> {
    /** The text. Bindable. */
    value?: string
    /** The field's name: its floating label, and always its accessible name. */
    label: string
    /** Don't show the label; it becomes `aria-label`. */
    hideLabel?: boolean
    /** A hint under the field. */
    supportingText?: string | undefined
    /** An error under the field, in place of the supporting text; marks the field invalid. */
    error?: string | undefined
    /** The rendered `<input>`. */
    element?: HTMLInputElement | undefined
  }

  let {
    value = $bindable(''),
    label,
    hideLabel = false,
    supportingText,
    error,
    element = $bindable(),
    class: className,
    id,
    ...rest
  }: Props = $props()

  const uid = $props.id()
  const inputId = $derived(id ?? `text-field-${uid}`)
  const supportId = `text-field-${uid}-support`
  const below = $derived(error ?? supportingText)
  const describedBy = $derived(
    [rest['aria-describedby'], below === undefined ? undefined : supportId]
      .filter((part) => part !== undefined && part !== null && part !== '')
      .join(' ') || undefined,
  )
</script>

<div
  class={[
    'text-field',
    { filled: value !== '', invalid: error !== undefined, labelled: !hideLabel },
    className,
  ]}
>
  <div class="field">
    <input
      bind:this={element}
      bind:value
      {...rest}
      id={inputId}
      aria-label={hideLabel ? label : rest['aria-label']}
      aria-describedby={describedBy}
      aria-invalid={error === undefined ? rest['aria-invalid'] : true}
    />
    {#if !hideLabel}
      <label for={inputId}>{label}</label>
    {/if}
    <fieldset class="outline" aria-hidden="true">
      <legend>
        {#if !hideLabel}<span>{label}</span>{/if}
      </legend>
    </fieldset>
  </div>
  <div class="support" id={supportId} aria-live="polite">
    {#if below !== undefined}{below}{/if}
  </div>
</div>

<style>
  .text-field {
    --_height: var(--text-field-height, 3.5rem);
    --_outline: var(--md-sys-color-outline);
    --_outline-width: 1px;
    --_label: var(--md-sys-color-on-surface-variant);
    display: inline-flex;
    flex-direction: column;
    inline-size: var(--text-field-width, 100%);
    min-inline-size: 0;
    color: var(--md-sys-color-on-surface);
  }

  .field {
    position: relative;
    display: flex;
    block-size: var(--_height);
  }

  input {
    position: relative;
    z-index: 1;
    flex: 1;
    min-inline-size: 0;
    padding-block: 0;
    padding-inline: 1rem;
    border: none;
    outline: none;
    background: transparent;
    color: inherit;
    font-size: 1rem;
    line-height: 1.5rem;
    text-align: var(--text-field-align, start);
  }

  .field:hover {
    --_outline: var(--md-sys-color-on-surface);
  }

  .field:focus-within {
    --_outline: var(--md-sys-color-primary);
    --_outline-width: 2px;
    --_label: var(--md-sys-color-primary);
  }

  .invalid,
  .invalid .field:hover,
  .invalid .field:focus-within {
    --_outline: var(--md-sys-color-error);
    --_label: var(--md-sys-color-error);
  }

  label {
    position: absolute;
    inset-block-start: calc(50% - 0.75rem);
    inset-inline-start: 0.75rem;
    z-index: 1;
    max-inline-size: calc(100% - 1.5rem);
    padding-inline: 0.25rem;
    overflow: hidden;
    color: var(--_label);
    font-size: 1rem;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
    transform-origin: left center;
    transition: transform var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  label:dir(rtl) {
    transform-origin: right center;
  }

  /* Floated: up onto the outline, at 12px. */
  .filled label,
  .field:focus-within label {
    transform: translateY(calc(var(--_height) / -2)) scale(0.75);
  }

  /*
   * The outline is a fieldset whose legend cuts the notch for the floating label. The legend is
   * as wide as the label at 12px (its text is invisible), and collapsed while the label rests.
   */
  .outline {
    position: absolute;
    inset: -0.3125rem 0 0;
    min-inline-size: 0;
    margin: 0;
    padding-block: 0;
    padding-inline: 0.6875rem;
    border: var(--_outline-width) solid var(--_outline);
    border-radius: var(--radius-extra-small, 4px);
    pointer-events: none;
  }

  legend {
    display: block;
    max-inline-size: 0.01px;
    block-size: 0.625rem;
    padding: 0;
    overflow: hidden;
    font-size: 0.75rem;
    line-height: 0.625rem;
    white-space: nowrap;
    visibility: hidden;
    transition: max-inline-size 50ms linear;
  }

  legend span {
    display: inline-block;
    padding-inline: 0.25rem;
  }

  .labelled.filled legend,
  .labelled .field:focus-within legend {
    max-inline-size: 100%;
    transition: max-inline-size 100ms linear 50ms;
  }

  .support {
    min-block-size: 0;
    padding-inline: 1rem;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .support:not(:empty) {
    padding-block-start: 0.25rem;
  }

  .invalid .support {
    color: var(--md-sys-color-error);
  }

  input:disabled {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  .field:has(input:disabled) {
    --_outline: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    --_label: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  @media (forced-colors: active) {
    .outline {
      border-color: CanvasText;
    }

    .field:focus-within .outline {
      border-color: Highlight;
    }

    .invalid .outline {
      border-style: dashed;
    }
  }
</style>
