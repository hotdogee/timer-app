<!--
  @component
  A styled native `<select>` in the Material 3 outlined style, for a short list of choices (font,
  language, sound). The browser's own picker opens it, so it works with the keyboard (arrows change
  the value directly; Space or Alt+Down open the list), with screen readers and on phones. `value`
  is bindable; `onchange` runs with the value the user picked.

  Name it with a visible `<label for={id}>`, `aria-labelledby`, or `label` (`aria-label`). Give an
  option `lang` when its label is in another language (the endonyms of the language setting).

  ```svelte
  <label for="font">Font</label>
  <Select id="font" value={font} options={fonts} onchange={(font) => update({ font })} />
  ```
-->
<script lang="ts" module>
  /** One choice of a {@link Select}. */
  export interface SelectOption<T extends string = string> {
    readonly value: T
    readonly label: string
    /** The language of the label, when it differs from the page's. */
    readonly lang?: string | undefined
  }
</script>

<script lang="ts" generics="T extends string">
  import type { HTMLSelectAttributes } from 'svelte/elements'

  interface Props extends Omit<
    HTMLSelectAttributes,
    'value' | 'children' | 'onchange' | 'multiple'
  > {
    /** The chosen value. Bindable. */
    value: T
    options: readonly SelectOption<T>[]
    /** Accessible name, when no visible label names the select. */
    label?: string | undefined
    /** Runs with the value the user picked. */
    onchange?: (value: T) => void
    /** The rendered `<select>`. */
    element?: HTMLSelectElement | undefined
  }

  let {
    value = $bindable(),
    options,
    label,
    onchange,
    element = $bindable(),
    class: className,
    ...rest
  }: Props = $props()

  function handleChange(event: Event & { currentTarget: HTMLSelectElement }) {
    const picked = options.find((option) => option.value === event.currentTarget.value)
    if (picked === undefined || picked.value === value) return
    value = picked.value
    onchange?.(picked.value)
  }
</script>

<span class={['select', className]}>
  <select
    bind:this={element}
    {...rest}
    aria-label={label ?? rest['aria-label']}
    onchange={handleChange}
  >
    {#each options as option (option.value)}
      <option value={option.value} lang={option.lang} selected={option.value === value}
        >{option.label}</option
      >
    {/each}
  </select>
  <svg class="arrow" viewBox="0 -960 960 960" aria-hidden="true" focusable="false">
    <path d="M480-360 280-559h400L480-360Z" />
  </svg>
</span>

<style>
  .select {
    position: relative;
    display: inline-flex;
    max-inline-size: 100%;
    color: var(--md-sys-color-on-surface);
  }

  select {
    flex: 1;
    min-inline-size: 0;
    min-block-size: var(--select-height, 2.75rem);
    padding-block: 0;
    padding-inline: 1rem 2.75rem;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--radius-extra-small, 4px);
    outline: none;
    background: transparent;
    color: inherit;
    font-size: 1rem;
    line-height: 1.5rem;
    text-overflow: ellipsis;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  select:hover {
    border-color: var(--md-sys-color-on-surface);
  }

  /* The M3 focus indicator: a thicker primary outline, drawn inside so nothing moves. */
  select:focus {
    border-color: var(--md-sys-color-primary);
    box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
  }

  option {
    background: var(--md-sys-color-surface-container);
    color: var(--md-sys-color-on-surface);
  }

  .arrow {
    position: absolute;
    inset-block-start: calc(50% - 0.75rem);
    inset-inline-end: 0.75rem;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    fill: var(--md-sys-color-on-surface-variant);
    pointer-events: none;
  }

  select:disabled {
    border-color: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  select:disabled + .arrow {
    fill: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
  }

  @media (forced-colors: active) {
    select {
      border-color: ButtonText;
    }

    select:focus {
      outline: 2px solid Highlight;
      outline-offset: 2px;
      box-shadow: none;
    }

    .arrow {
      fill: ButtonText;
    }
  }
</style>
