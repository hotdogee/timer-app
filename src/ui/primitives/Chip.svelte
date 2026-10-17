<!--
  @component
  A Material 3 assist chip: a small pill button such as the card's quick-add `+1:00`. The visible
  pill can be smaller than a touch target; an invisible extension keeps the hit area at least
  `--touch-target` tall. Size it with `--chip-font-size` (everything else scales from it) and color
  its pill with `--chip-container`.

  ```svelte
  <Chip label="+1:00" onclick={() => add(60_000)} />
  ```
-->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'

  import Icon from './Icon.svelte'
  import type { IconName } from './icons'

  interface Props extends Omit<HTMLButtonAttributes, 'children' | 'type'> {
    /** Visible text and accessible name. */
    label: string
    /** Optional leading icon. */
    icon?: IconName
    /** The rendered `<button>`. */
    element?: HTMLButtonElement | undefined
  }

  let { label, icon, element = $bindable(), class: className, ...rest }: Props = $props()
</script>

<button bind:this={element} {...rest} type="button" class={['chip', className]}>
  {#if icon}
    <span class="icon"><Icon name={icon} /></span>
  {/if}
  <span class="label">{label}</span>
</button>

<style>
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 0.5em;
    block-size: 2.4em;
    padding-block: 0;
    padding-inline: 1em;
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    background: var(--chip-container, var(--md-sys-color-surface-container-highest));
    color: var(--md-sys-color-on-surface);
    font-size: var(--chip-font-size, 0.875rem);
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.00714em;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }

  /* Invisible hit-area extension up to the touch target height. */
  .chip::after {
    content: '';
    position: absolute;
    inset-block: min(0px, calc((100% - var(--touch-target, 44px)) / 2));
    inset-inline: 0;
  }

  .chip::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .chip:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .chip:focus-visible::before {
    opacity: var(--state-focus, 0.1);
  }

  .chip:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .chip:disabled {
    background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  .chip:disabled::before {
    opacity: 0;
  }

  .icon {
    display: inline-flex;
    font-size: 1.25em;
  }

  @media (forced-colors: active) {
    .chip::before {
      display: none;
    }

    .chip:disabled {
      border-color: GrayText;
      color: GrayText;
    }
  }
</style>
