<!--
  @component
  A round, icon-only Material 3 button (standard style: no container). `label` is required and
  becomes `aria-label` and the tooltip. Pass `pressed` to make it a toggle (`aria-pressed`); keep
  the label constant and let the pressed state carry the meaning (label "Mute", pressed = muted).

  Color and size come from `--icon-button-color`, `--icon-button-pressed-color`,
  `--icon-button-size` and `--icon-button-icon-size`; the hit area never drops below
  `--touch-target`.

  ```svelte
  <IconButton icon={muted ? 'volume_off' : 'volume_up'} label="Mute" pressed={muted} onclick={toggle} />
  ```
-->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'

  import Icon from './Icon.svelte'
  import type { IconName } from './icons'

  interface Props extends Omit<HTMLButtonAttributes, 'children' | 'type'> {
    icon: IconName
    /** Accessible name and tooltip. */
    label: string
    /** Toggle state. Leave it out for a plain action button. */
    pressed?: boolean
    type?: 'button' | 'submit' | 'reset'
    /** The rendered `<button>`, for focusing or anchoring a menu. */
    element?: HTMLButtonElement | undefined
  }

  let {
    icon,
    label,
    pressed,
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
  class={['icon-button', { pressed }, className]}
  aria-label={label}
  aria-pressed={pressed}
  title={rest.title ?? label}
>
  <Icon name={icon} />
</button>

<style>
  .icon-button {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex: none;
    inline-size: max(var(--touch-target, 44px), var(--icon-button-size, 2.75rem));
    block-size: max(var(--touch-target, 44px), var(--icon-button-size, 2.75rem));
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    background: transparent;
    color: var(--icon-button-color, var(--md-sys-color-on-surface-variant));
    font-size: var(--icon-button-icon-size, 1.5rem);
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
  }

  .pressed {
    color: var(--icon-button-pressed-color, var(--md-sys-color-primary));
  }

  .icon-button::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .icon-button:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .icon-button:focus-visible::before {
    opacity: var(--state-focus, 0.1);
  }

  .icon-button:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .icon-button:disabled {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  .icon-button:disabled::before {
    opacity: 0;
  }

  @media (forced-colors: active) {
    .icon-button::before {
      display: none;
    }

    .pressed {
      border-color: Highlight;
    }

    .icon-button:disabled {
      color: GrayText;
    }
  }
</style>
