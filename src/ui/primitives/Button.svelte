<!--
  @component
  A Material 3 pill button. `label` is always the accessible name; with `hideLabel` only the icon
  shows (the card's Start, Pause and Reset buttons) and the label becomes `aria-label` and a tooltip.

  Variants: `filled` (primary), `tonal` (`--button-tonal-container` and `--button-tonal-content`,
  by default surface-container-highest with on-surface content: the card's secondary buttons) and
  `text`. Size it from outside with `--button-height`,
  `--button-font-size`, `--button-icon-size` and `--button-padding`; it never gets shorter than
  `--touch-target`.

  ```svelte
  <Button label="Start" icon="play_arrow" hideLabel fullWidth onclick={start} />
  <Button variant="tonal" label="Lap" icon="flag" onclick={lap} />
  ```
-->
<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  import Icon from './Icon.svelte'
  import type { IconName } from './icons'

  interface Props extends Omit<HTMLButtonAttributes, 'children' | 'type'> {
    /** Visible text, and always the accessible name. */
    label: string
    /** Show only the icon; `label` becomes `aria-label` and the tooltip. */
    hideLabel?: boolean
    variant?: 'filled' | 'tonal' | 'text'
    /** A Material Symbol name, or a snippet for custom leading content. */
    icon?: IconName | Snippet
    /** Stretch to the container's full inline size. */
    fullWidth?: boolean
    type?: 'button' | 'submit' | 'reset'
    /** The rendered `<button>`, for focusing or anchoring a menu. */
    element?: HTMLButtonElement | undefined
  }

  let {
    label,
    hideLabel = false,
    variant = 'filled',
    icon,
    fullWidth = false,
    type = 'button',
    element = $bindable(),
    class: className,
    ...rest
  }: Props = $props()
</script>

<button
  bind:this={element}
  {...rest}
  {type}
  class={['button', variant, { 'full-width': fullWidth, 'icon-only': hideLabel }, className]}
  aria-label={hideLabel ? label : rest['aria-label']}
  title={rest.title ?? (hideLabel ? label : undefined)}
>
  {#if typeof icon === 'string'}
    <span class="icon"><Icon name={icon} /></span>
  {:else if icon}
    <span class="icon">{@render icon()}</span>
  {/if}
  {#if !hideLabel}
    <span class="label">{label}</span>
  {/if}
</button>

<style>
  .button {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    min-block-size: max(var(--touch-target, 44px), var(--button-height, 2.75rem));
    min-inline-size: var(--touch-target, 44px);
    padding-block: 0;
    padding-inline: var(--button-padding, 1.5em);
    /* Transparent until forced-colors mode paints it, so the button keeps its outline there. */
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    background: var(--_container);
    color: var(--_content);
    font-size: var(--button-font-size, 0.875rem);
    font-weight: 500;
    line-height: 1.25;
    letter-spacing: 0.00714em;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  /* M3 state layer: the content color, faintly, over the whole button. */
  .button::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .button:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .button:focus-visible::before {
    opacity: var(--state-focus, 0.1);
  }

  .button:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .filled {
    --_container: var(--md-sys-color-primary);
    --_content: var(--md-sys-color-on-primary);
  }

  .tonal {
    --_container: var(--button-tonal-container, var(--md-sys-color-surface-container-highest));
    --_content: var(--button-tonal-content, var(--md-sys-color-on-surface));
  }

  .text {
    --_container: transparent;
    --_content: var(--md-sys-color-primary);
    padding-inline: var(--button-padding, 0.75em);
  }

  .icon-only {
    padding-inline: var(--button-padding, 1em);
  }

  .full-width {
    display: flex;
    inline-size: 100%;
  }

  /* `aria-disabled` looks the same but keeps the focus (a button that is busy for a moment). */
  .button:disabled,
  .button[aria-disabled='true'] {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  .text:disabled,
  .text[aria-disabled='true'] {
    background: transparent;
  }

  .button:disabled::before,
  .button[aria-disabled='true']::before {
    opacity: 0;
  }

  .icon {
    display: inline-flex;
    font-size: var(--button-icon-size, 1.25em);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (forced-colors: active) {
    .button::before {
      display: none;
    }

    .button:disabled,
    .button[aria-disabled='true'] {
      border-color: GrayText;
      color: GrayText;
    }
  }
</style>
