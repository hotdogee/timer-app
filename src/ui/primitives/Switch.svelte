<!--
  @component
  A Material 3 switch: a `<button role="switch">` with `aria-checked`, so Space and Enter toggle it
  and a `<label for>` pointing at it names it (and toggles it when clicked). `checked` is bindable;
  `onchange` runs with the new state after each toggle by the user.

  Name it with a visible `<label for={id}>`, `aria-labelledby`, or `label` (which becomes
  `aria-label`). The visible switch is 52×32; an invisible extension keeps the hit area at least
  `--touch-target` tall.

  ```svelte
  <label for="loop">Loop sound</label>
  <Switch id="loop" checked={loop} onchange={(on) => update({ loop: on })} />
  ```
-->
<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements'

  import Icon from './Icon.svelte'

  interface Props extends Omit<
    HTMLButtonAttributes,
    'children' | 'type' | 'role' | 'onchange' | 'value'
  > {
    /** Whether the switch is on. Bindable. */
    checked?: boolean
    /** Accessible name, when no visible label names the switch. */
    label?: string | undefined
    /** Runs with the new state after the user toggles the switch. */
    onchange?: (checked: boolean) => void
    /** The rendered `<button>`. */
    element?: HTMLButtonElement | undefined
  }

  let {
    checked = $bindable(false),
    label,
    onchange,
    element = $bindable(),
    class: className,
    onclick,
    ...rest
  }: Props = $props()

  function toggle(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    onclick?.(event)
    if (event.defaultPrevented) return
    checked = !checked
    onchange?.(checked)
  }
</script>

<button
  bind:this={element}
  {...rest}
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label ?? rest['aria-label']}
  class={['switch', { checked }, className]}
  onclick={toggle}
>
  <span class="handle" aria-hidden="true">
    <span class="icon"><Icon name="check" /></span>
  </span>
</button>

<style>
  .switch {
    --_track: var(--md-sys-color-surface-container-highest);
    --_outline: var(--md-sys-color-outline);
    --_handle: var(--md-sys-color-outline);
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
    inline-size: 3.25rem;
    block-size: 2rem;
    padding: 0;
    border: 2px solid var(--_outline);
    border-radius: var(--radius-pill, 999px);
    background: var(--_track);
    cursor: pointer;
    touch-action: manipulation;
    transition:
      background-color var(--duration-short, 150ms) var(--easing-standard, ease),
      border-color var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  /* Invisible hit-area extension up to the touch target height. */
  .switch::after {
    content: '';
    position: absolute;
    inset-block: min(-2px, calc((100% - var(--touch-target, 44px)) / 2));
    inset-inline: -2px;
  }

  .checked {
    --_track: var(--md-sys-color-primary);
    --_outline: var(--md-sys-color-primary);
    --_handle: var(--md-sys-color-on-primary);
  }

  /*
   * The handle is 24px and shrinks to 16px when off (scale), and the hover/focus state layer is a
   * 40px circle around it. Only transform and opacity animate.
   */
  .handle {
    position: absolute;
    inset-block-start: calc(50% - 0.75rem);
    inset-inline-start: 0.125rem;
    display: grid;
    place-items: center;
    inline-size: 1.5rem;
    block-size: 1.5rem;
    border-radius: 50%;
    background: var(--_handle);
    transform: scale(0.6667);
    transition:
      transform var(--duration-short, 150ms) var(--easing-standard, ease),
      background-color var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .checked .handle {
    transform: translateX(1.25rem);
  }

  .handle::before {
    content: '';
    position: absolute;
    inset: -0.5rem;
    border-radius: 50%;
    background: var(--md-sys-color-on-surface);
    opacity: 0;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .checked .handle::before {
    background: var(--md-sys-color-primary);
  }

  .switch:hover .handle::before {
    opacity: var(--state-hover, 0.08);
  }

  .switch:focus-visible .handle::before,
  .switch:active .handle::before {
    opacity: var(--state-focus, 0.1);
  }

  .switch:hover:not(.checked) {
    --_handle: var(--md-sys-color-on-surface-variant);
  }

  .switch.checked:hover {
    --_handle: var(--md-sys-color-primary-container);
  }

  .switch:active:not(:disabled) .handle {
    transform: scale(1.1667);
  }

  .switch.checked:active:not(:disabled) .handle {
    transform: translateX(1.25rem) scale(1.1667);
  }

  .icon {
    position: relative;
    display: inline-flex;
    font-size: 1rem;
    color: var(--md-sys-color-on-primary-container);
    opacity: 0;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .checked .icon {
    opacity: 1;
  }

  .switch.checked:dir(rtl) .handle {
    transform: translateX(-1.25rem);
  }

  .switch:disabled {
    opacity: 0.38;
    cursor: default;
  }

  .switch:disabled .handle::before {
    opacity: 0;
  }

  @media (forced-colors: active) {
    .switch {
      border-color: ButtonText;
      background: ButtonFace;
    }

    .handle {
      background: ButtonText;
    }

    .checked {
      border-color: Highlight;
      background: Highlight;
    }

    .checked .handle {
      background: HighlightText;
    }

    .icon {
      color: Highlight;
    }

    .handle::before {
      display: none;
    }

    .switch:disabled {
      border-color: GrayText;
      opacity: 1;
    }

    .switch:disabled .handle {
      background: GrayText;
    }
  }
</style>
