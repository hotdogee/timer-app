<!--
  @component
  Material 3 single-select segmented buttons for two to five choices (theme: System, Light, Dark).
  Each segment is a native radio input in a `role="radiogroup"`, so Tab enters at the chosen
  segment and the arrow keys move and choose. `value` is bindable; `onchange` runs with the value
  the user picked. The selected segment shows a check mark.

  Name the group with `label`, or `aria-labelledby` for a visible label. Segments share the widest
  label's width; `fullWidth` stretches the group across its container.

  ```svelte
  <SegmentedButtons aria-labelledby="theme-label" value={mode} options={modes}
    onchange={(themeMode) => update({ themeMode })} />
  ```
-->
<script lang="ts" module>
  /** One choice of a {@link SegmentedButtons} group. */
  export interface SegmentOption<T extends string = string> {
    readonly value: T
    readonly label: string
  }
</script>

<script lang="ts" generics="T extends string">
  import Icon from './Icon.svelte'

  interface Props {
    /** The chosen value. Bindable. */
    value: T
    options: readonly SegmentOption<T>[]
    /** Accessible name of the group, when no visible label is referenced. */
    label?: string | undefined
    'aria-labelledby'?: string | undefined
    'aria-describedby'?: string | undefined
    /** The radio group's `name`; unique by default. */
    name?: string | undefined
    disabled?: boolean
    /** Stretch across the container instead of hugging the labels. */
    fullWidth?: boolean
    /** Runs with the value the user picked. */
    onchange?: (value: T) => void
    class?: string | undefined
  }

  let {
    value = $bindable(),
    options,
    label,
    'aria-labelledby': labelledBy,
    'aria-describedby': describedBy,
    name,
    disabled = false,
    fullWidth = false,
    onchange,
    class: className,
  }: Props = $props()

  const uid = $props.id()
  const groupName = $derived(name ?? `segmented-${uid}`)

  function pick(next: T) {
    if (next === value) return
    value = next
    onchange?.(next)
  }
</script>

<div
  role="radiogroup"
  class={['segmented', { 'full-width': fullWidth }, className]}
  aria-label={label}
  aria-labelledby={labelledBy}
  aria-describedby={describedBy}
>
  {#each options as option (option.value)}
    <label class={['segment', { selected: option.value === value, disabled }]}>
      <input
        type="radio"
        name={groupName}
        value={option.value}
        checked={option.value === value}
        {disabled}
        onchange={() => {
          pick(option.value)
        }}
      />
      <span class="check" aria-hidden="true"><Icon name="check" /></span>
      <span class="text">{option.label}</span>
    </label>
  {/each}
</div>

<style>
  .segmented {
    display: inline-grid;
    grid-auto-columns: minmax(max-content, 1fr);
    grid-auto-flow: column;
    max-inline-size: 100%;
  }

  .full-width {
    display: grid;
  }

  .segment {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-inline-size: 0;
    block-size: 2.5rem;
    padding-inline: 0.75rem;
    border: 1px solid var(--md-sys-color-outline);
    border-inline-start-width: 0;
    background: transparent;
    color: var(--md-sys-color-on-surface);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.00714em;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  .segment:first-child {
    border-inline-start-width: 1px;
    border-start-start-radius: var(--radius-pill, 999px);
    border-end-start-radius: var(--radius-pill, 999px);
  }

  .segment:last-child {
    border-start-end-radius: var(--radius-pill, 999px);
    border-end-end-radius: var(--radius-pill, 999px);
  }

  /* Invisible hit-area extension up to the touch target height. */
  .segment::after {
    content: '';
    position: absolute;
    inset-block: min(0px, calc((100% - var(--touch-target, 44px)) / 2));
    inset-inline: 0;
  }

  .segment::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .segment:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .segment:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .segment:has(input:focus-visible) {
    z-index: 1;
    outline: 2px solid var(--md-sys-color-primary, Highlight);
    outline-offset: 2px;
  }

  .segment:has(input:focus-visible)::before {
    opacity: var(--state-focus, 0.1);
  }

  .selected {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  /* The real control: invisible, covering the segment, so it takes clicks and keyboard focus. */
  input {
    position: absolute;
    inset: 0;
    z-index: 1;
    inline-size: 100%;
    block-size: 100%;
    margin: 0;
    opacity: 0;
    cursor: inherit;
  }

  .check {
    display: none;
    font-size: 1.125rem;
  }

  .selected .check {
    display: inline-flex;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .disabled {
    border-color: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  .disabled::before {
    opacity: 0;
  }

  @media (forced-colors: active) {
    .segment {
      border-color: ButtonText;
    }

    .segment::before {
      display: none;
    }

    /* Painted by us: the browser's text backplate would hide HighlightText on Highlight. */
    .selected {
      background: Highlight;
      color: HighlightText;
      forced-color-adjust: none;
    }

    .segment:has(input:focus-visible) {
      outline-color: Highlight;
    }

    .disabled {
      border-color: GrayText;
      color: GrayText;
    }
  }
</style>
