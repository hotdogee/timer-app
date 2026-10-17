<!--
  @component
  A Material 3 slider on a styled native `<input type="range">`, with its value shown at the end.
  The arrow keys, Page Up/Down, Home and End move it, as the browser does for any range input.
  `value` is bindable; `oninput` runs while it moves and `onchange` when the user lets go (or after
  each key press).

  `valueText` turns the value into text (`125%`); that text is shown and is also the input's
  `aria-valuetext`, so screen readers say what the user sees. Name it with a visible
  `<label for={id}>`, `aria-labelledby`, or `label` (`aria-label`).

  ```svelte
  <Slider id="volume" min={0} max={1} step={0.05} value={volume}
    valueText={(v) => `${Math.round(v * 100)}%`} oninput={(volume) => update({ volume })} />
  ```
-->
<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements'

  interface Props extends Omit<
    HTMLInputAttributes,
    'value' | 'type' | 'min' | 'max' | 'step' | 'oninput' | 'onchange' | 'children'
  > {
    /** The current value. Bindable. */
    value: number
    min: number
    max: number
    step: number
    /** Accessible name, when no visible label names the slider. */
    label?: string | undefined
    /** The value as text, shown and announced. Defaults to the number itself. */
    valueText?: (value: number) => string
    /** Show the value text at the end of the track. */
    showValue?: boolean
    /** Runs while the user moves the slider. */
    oninput?: (value: number) => void
    /** Runs when the user commits a value (pointer released, or a key press). */
    onchange?: (value: number) => void
    /** The rendered `<input>`. */
    element?: HTMLInputElement | undefined
  }

  let {
    value = $bindable(),
    min,
    max,
    step,
    label,
    valueText = (v: number) => String(v),
    showValue = true,
    oninput,
    onchange,
    element = $bindable(),
    class: className,
    ...rest
  }: Props = $props()

  const text = $derived(valueText(value))
  const fraction = $derived(max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0)

  function read(event: Event & { currentTarget: HTMLInputElement }): number {
    return Number(event.currentTarget.value)
  }
</script>

<span class={['slider', className]} style:--_fraction={fraction}>
  <input
    bind:this={element}
    {...rest}
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-label={label ?? rest['aria-label']}
    aria-valuetext={text}
    oninput={(event) => {
      value = read(event)
      oninput?.(value)
    }}
    onchange={(event) => {
      value = read(event)
      onchange?.(value)
    }}
  />
  {#if showValue}
    <span class="value" aria-hidden="true">{text}</span>
  {/if}
</span>

<style>
  .slider {
    --_thumb: 1.25rem;
    --_track: 0.25rem;
    --_fill-at: calc(var(--_thumb) / 2 + (100% - var(--_thumb)) * var(--_fraction));
    display: inline-flex;
    align-items: center;
    gap: var(--space-3, 0.75rem);
    inline-size: var(--slider-width, 14rem);
    max-inline-size: 100%;
  }

  input {
    flex: 1;
    min-inline-size: 6rem;
    block-size: var(--touch-target, 44px);
    margin: 0;
    background: transparent;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
  }

  input:focus-visible {
    outline: none;
  }

  input::-webkit-slider-runnable-track {
    block-size: var(--_track);
    border-radius: var(--radius-pill, 999px);
    background: linear-gradient(
      to right,
      var(--md-sys-color-primary) var(--_fill-at),
      var(--md-sys-color-outline-variant) var(--_fill-at)
    );
  }

  input::-moz-range-track {
    block-size: var(--_track);
    border-radius: var(--radius-pill, 999px);
    background: var(--md-sys-color-outline-variant);
  }

  input::-moz-range-progress {
    block-size: var(--_track);
    border-radius: var(--radius-pill, 999px);
    background: var(--md-sys-color-primary);
  }

  input::-webkit-slider-thumb {
    inline-size: var(--_thumb);
    block-size: var(--_thumb);
    margin-block-start: calc((var(--_track) - var(--_thumb)) / 2);
    border: none;
    border-radius: 50%;
    background: var(--md-sys-color-primary);
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow var(--duration-short, 150ms) var(--easing-standard, ease);
    appearance: none;
    -webkit-appearance: none;
  }

  input::-moz-range-thumb {
    inline-size: var(--_thumb);
    block-size: var(--_thumb);
    border: none;
    border-radius: 50%;
    background: var(--md-sys-color-primary);
    box-shadow: 0 0 0 0 transparent;
    transition: box-shadow var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  /* The state layer: a halo around the thumb. */
  input:hover::-webkit-slider-thumb {
    box-shadow: 0 0 0 0.625rem
      color-mix(
        in srgb,
        var(--md-sys-color-primary) calc(var(--state-hover, 0.08) * 100%),
        transparent
      );
  }

  input:hover::-moz-range-thumb {
    box-shadow: 0 0 0 0.625rem
      color-mix(
        in srgb,
        var(--md-sys-color-primary) calc(var(--state-hover, 0.08) * 100%),
        transparent
      );
  }

  /* Keyboard focus: a ring around the thumb, in the app's focus color. */
  input:focus-visible::-webkit-slider-thumb {
    box-shadow:
      0 0 0 2px var(--slider-ring-gap, var(--md-sys-color-surface-container-high)),
      0 0 0 4px var(--md-sys-color-primary);
  }

  input:focus-visible::-moz-range-thumb {
    box-shadow:
      0 0 0 2px var(--slider-ring-gap, var(--md-sys-color-surface-container-high)),
      0 0 0 4px var(--md-sys-color-primary);
  }

  .value {
    flex: none;
    min-inline-size: var(--slider-value-width, 3rem);
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  input:disabled {
    cursor: default;
    opacity: 0.38;
  }

  @media (forced-colors: active) {
    input::-webkit-slider-runnable-track {
      background: ButtonText;
    }

    input::-webkit-slider-thumb {
      background: Highlight;
    }

    input:focus-visible {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
</style>
