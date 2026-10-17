<!--
  @component
  A small popover menu anchored to a trigger (the action bar's "+ Timer" list). It opens in the top
  layer where the Popover API exists, focuses its first item, and owns the keyboard while open:
  arrows, Home and End move, Enter or Space picks, Esc closes and returns focus to the trigger,
  Tab closes. A pointer press outside closes it. Key presses do not reach global shortcuts.

  The trigger toggles `open` itself and should carry `aria-haspopup="menu"`,
  `aria-expanded={open}` and `aria-controls` set to this menu's `id`.

  ```svelte
  <Button bind:element={trigger} label="Timer" icon="add" aria-haspopup="menu"
    aria-expanded={open} aria-controls="timer-menu" onclick={() => (open = !open)} />
  <Menu id="timer-menu" bind:open anchor={trigger} label="New timer" {items} onselect={create} />
  ```
-->
<script lang="ts">
  import { untrack } from 'svelte'

  import Icon from './Icon.svelte'
  import {
    nextEnabledIndex,
    placeMenu,
    type MenuAlign,
    type MenuItem,
    type MenuPlacement,
  } from './menu'

  interface Props {
    /** Whether the menu is shown. Bindable; the menu sets it to false when it closes itself. */
    open?: boolean
    /** The trigger the menu is placed against and returns focus to. */
    anchor: HTMLElement | null | undefined
    items: readonly MenuItem[]
    /** Accessible name of the menu. */
    label: string
    /** Called with the picked item; the menu then closes. */
    onselect: (item: MenuItem) => void
    /** Called whenever the menu closes itself (pick, Esc, Tab, outside press). */
    onclose?: () => void
    /** Preferred side of the trigger; flips when there is no room. */
    placement?: MenuPlacement
    /** Which inline edge of the trigger to line up with. */
    align?: MenuAlign
    id?: string
  }

  let {
    open = $bindable(false),
    anchor,
    items,
    label,
    onselect,
    onclose,
    placement = 'below',
    align = 'start',
    id,
  }: Props = $props()

  let menu = $state<HTMLDivElement | null>(null)
  let active = $state(-1)
  /** The side the menu actually opened on, after flipping; sets the animation origin. */
  let shownPlacement: MenuPlacement = $state('below')

  // Without the Popover API (older WebKit) the menu is a plain fixed-position layer.
  const supportsPopover = typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype

  function itemButtons(): HTMLButtonElement[] {
    return menu ? [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : []
  }

  function focusItem(index: number) {
    if (index < 0) return
    active = index
    itemButtons()[index]?.focus()
  }

  function place() {
    if (!menu || !anchor) return
    const rect = anchor.getBoundingClientRect()
    // The layout size: the opening animation scales the menu, which a bounding rect would include.
    const size = { width: menu.offsetWidth, height: menu.offsetHeight }
    const position = placeMenu(
      rect,
      size,
      { width: document.documentElement.clientWidth, height: window.innerHeight },
      { placement, align, rtl: getComputedStyle(anchor).direction === 'rtl' },
    )
    menu.style.top = `${position.top}px`
    menu.style.left = `${position.left}px`
    shownPlacement = position.placement
  }

  function close(restoreFocus: boolean) {
    if (!open) return
    open = false
    onclose?.()
    if (restoreFocus) anchor?.focus()
  }

  function choose(item: MenuItem) {
    if (item.disabled) return
    onselect(item)
    close(true)
  }

  function handleKeydown(event: KeyboardEvent) {
    // While open, the menu owns the keyboard: nothing reaches the app's global shortcuts.
    event.stopPropagation()
    switch (event.key) {
      case 'ArrowDown':
        focusItem(nextEnabledIndex(items, active, 1))
        break
      case 'ArrowUp':
        focusItem(nextEnabledIndex(items, active, -1))
        break
      case 'Home':
        focusItem(nextEnabledIndex(items, -1, 1))
        break
      case 'End':
        focusItem(nextEnabledIndex(items, items.length, -1))
        break
      case 'Escape':
        close(true)
        break
      case 'Tab':
        // Let focus move on naturally; the menu just goes away.
        close(false)
        return
      default:
        return
    }
    event.preventDefault()
  }

  $effect(() => {
    if (!open || !menu) return
    const element = menu
    untrack(() => {
      if (supportsPopover) element.showPopover()
      place()
      focusItem(nextEnabledIndex(items, -1, 1))
    })

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && (element.contains(target) || anchor?.contains(target))) return
      close(false)
    }
    const onViewportChange = () => {
      place()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, { capture: true })
    }
  })
</script>

{#if open}
  <div
    bind:this={menu}
    {id}
    class="menu"
    role="menu"
    aria-label={label}
    tabindex="-1"
    popover={supportsPopover ? 'manual' : undefined}
    data-placement={shownPlacement}
    onkeydown={handleKeydown}
  >
    {#each items as item, index (item.id)}
      <button
        type="button"
        role="menuitem"
        class="item"
        tabindex={index === active ? 0 : -1}
        disabled={item.disabled}
        aria-disabled={item.disabled}
        onclick={() => {
          choose(item)
        }}
        onfocus={() => {
          active = index
        }}
      >
        {#if item.icon}
          <span class="icon"><Icon name={item.icon} /></span>
        {/if}
        <span class="label">{item.label}</span>
        {#if item.hint}
          <span class="hint">{item.hint}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .menu {
    position: fixed;
    inset: auto;
    z-index: 10;
    display: flex;
    flex-direction: column;
    min-inline-size: 7rem;
    max-inline-size: min(20rem, calc(100vw - 16px));
    max-block-size: calc(100dvh - 16px);
    margin: 0;
    padding-block: var(--space-2, 0.5rem);
    padding-inline: 0;
    overflow-y: auto;
    border: none;
    border-radius: var(--radius-small, 8px);
    background: var(--md-sys-color-surface-container);
    color: var(--md-sys-color-on-surface);
    box-shadow: var(--shadow-2);
    transform-origin: top;
    animation: menu-in var(--duration-short, 150ms) var(--easing-decelerate, ease-out);
  }

  .menu[data-placement='above'] {
    transform-origin: bottom;
  }

  @keyframes menu-in {
    from {
      opacity: 0;
      transform: scaleY(0.9);
    }
  }

  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3, 0.75rem);
    min-block-size: max(var(--touch-target, 44px), 3rem);
    padding-block: 0;
    padding-inline: var(--space-3, 0.75rem);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25;
    text-align: start;
    cursor: pointer;
  }

  .item::before {
    content: '';
    position: absolute;
    inset: 0;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
  }

  .item:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .item:focus-visible {
    outline-offset: -2px;
  }

  .item:focus-visible::before {
    opacity: var(--state-focus, 0.1);
  }

  .item:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .item:disabled {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  .item:disabled::before {
    opacity: 0;
  }

  .item:disabled .icon,
  .item:disabled .hint {
    color: inherit;
  }

  .icon {
    display: inline-flex;
    font-size: 1.5rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .label {
    flex: 1;
  }

  .hint {
    color: var(--md-sys-color-on-surface-variant);
    font-variant-numeric: tabular-nums;
  }

  @media (forced-colors: active) {
    .menu {
      border: 1px solid CanvasText;
    }

    .item::before {
      display: none;
    }

    .item:disabled {
      color: GrayText;
    }
  }
</style>
