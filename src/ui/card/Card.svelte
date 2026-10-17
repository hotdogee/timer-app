<!--
  @component
  The card shell shared by timers and stopwatches: the Material 3 surface (3:2, scaled by container
  queries), the header, selection, fullscreen and edit-mode affordances. The kind-specific parts
  come in as snippets: `face` (digits, ring, chips; it gets the id to give the digits),
  `controls` (the button row) and `after` (content below the 3:2 area, such as laps, which makes
  the card taller).

  Clicking or focusing anything in a card selects it. When the selection moves here while focus is
  on another card (arrow keys), focus follows, so Space and Enter keep acting on what is selected.
  When a phase change replaces the focused control (Start becomes Pause), focus moves to the
  control in its place instead of falling to the page.

  A screen reader hears the card's name, then its kind, state and time ("Tea. Timer, running,
  4:53"). In native fullscreen the rest of the page is inert, so the card carries its own copy of
  the live region.
-->
<script lang="ts">
  import { untrack, type Snippet } from 'svelte'

  import type { cards } from '../../core'
  import { FALLBACK_ATTRIBUTE, platform } from '../../platform'
  import { cardStore } from '../../state/cards.svelte'
  import Announcer from '../Announcer.svelte'
  import CardHeader from './CardHeader.svelte'
  import { cardStatus } from './display'
  import type { CardShellProps } from './types'

  interface Props extends CardShellProps {
    card: cards.Card
    /** The card's phase, exposed as `data-phase` for styling and tests. */
    phase: string
    /** The digits and ring; give the digits the id it receives, for the card's description. */
    face: Snippet<[string]>
    controls: Snippet
    after?: Snippet | undefined
  }

  let {
    card,
    phase,
    selected,
    editing,
    renaming,
    inert = false,
    onrenameend,
    ondragstart,
    onstep,
    face,
    controls,
    after,
  }: Props = $props()

  const uid = $props.id()
  const statusId = `${uid}-status`
  const digitsId = `${uid}-digits`
  const status = $derived(cardStatus(card))

  let element = $state<HTMLElement>()
  let controlRow = $state<HTMLElement>()
  /** Shown fullscreen, natively or as the overlay. */
  let fullscreen = $state(false)
  /** Shown as the overlay (no Fullscreen API), where the page around it stays live. */
  let overlay = $state(false)

  $effect(() => {
    const el = element
    if (!el) return
    const follow = (current: Element | null): void => {
      fullscreen = current === el
      overlay = fullscreen && el.hasAttribute(FALLBACK_ATTRIBUTE)
    }
    follow(platform.fullscreen.element)
    return platform.fullscreen.onChange(follow)
  })

  function toggleFullscreen(): void {
    if (element) void platform.fullscreen.toggle(element)
  }

  function select(): void {
    if (!selected) cardStore.select(card.id)
  }

  /** Whether `node` is a text field, which keeps focus whatever the selection does. */
  function isTextField(node: Element | null): boolean {
    return node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
  }

  // When the selection arrives here: bring the card into view and, if focus is on another card,
  // move focus here.
  $effect(() => {
    if (!selected || !element) return
    const el = element
    untrack(() => {
      const active = document.activeElement
      const owner = active?.closest('[data-card-id]') ?? null
      if (owner !== null && owner !== el && !isTextField(active)) el.focus({ preventScroll: true })
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  })

  // ── Focus across a phase change ──────────────────────────────────────────────────────────
  // A phase change swaps the controls (Start → Pause, Reset → Start) and can make the chips inert
  // (time's up), dropping focus to the page. The change can come from a click, a key or the frame
  // loop (a timer running out), so focus events keep track of where focus is in the card, and
  // after the swap focus goes to the control in the same place, or to the card.
  function controlButtons(): HTMLElement[] {
    return controlRow ? [...controlRow.querySelectorAll<HTMLElement>('button')] : []
  }

  /** Where focus is in the card: a control's index, -1 elsewhere in the card, null outside. */
  let focusedAt: number | null = null

  function onFocusIn(event: FocusEvent): void {
    select()
    focusedAt = event.target instanceof HTMLElement ? controlButtons().indexOf(event.target) : -1
  }

  function onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget
    if (next instanceof Node && element?.contains(next) === true) return
    // Focus left the card, unless its control was removed (a swap): then it stays remembered.
    const target = event.target
    queueMicrotask(() => {
      if (target instanceof Node && target.isConnected) focusedAt = null
    })
  }

  $effect(() => {
    void phase
    untrack(() => {
      const before = focusedAt
      const active = document.activeElement
      const lost = active === null || active === document.body || active.closest('[inert]') !== null
      if (before === null || !lost || !element) return
      const buttons = controlButtons()
      const target = before >= 0 ? buttons[Math.min(before, buttons.length - 1)] : undefined
      ;(target ?? element).focus({ preventScroll: true })
    })
  })

  function endRename(refocus: boolean): void {
    if (refocus) element?.focus()
    onrenameend?.()
  }
</script>

<!-- A grid cell: selection is a click, focus or arrow keys away; its controls are real buttons. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  bind:this={element}
  class={['card', { selected }]}
  role="gridcell"
  tabindex="0"
  aria-selected={selected}
  aria-label={card.name}
  aria-describedby="{statusId} {digitsId}"
  data-card-id={card.id}
  data-kind={card.kind}
  data-phase={phase}
  {inert}
  onclick={select}
  onfocusin={onFocusIn}
  onfocusout={onFocusOut}
>
  <span id={statusId} class="visually-hidden">{status}</span>
  <div class="main">
    <CardHeader
      {card}
      {editing}
      {renaming}
      {fullscreen}
      ontogglefullscreen={toggleFullscreen}
      onrenameend={endRename}
      {ondragstart}
      {onstep}
    />
    <div class="face">
      <div class="stage">
        {@render face(digitsId)}
      </div>
    </div>
    <div class="controls" bind:this={controlRow}>
      {@render controls()}
    </div>
  </div>
  {@render after?.()}
  {#if fullscreen && !overlay}
    <Announcer />
  {/if}
</div>

<style>
  .card {
    container: card / inline-size;
    display: flex;
    flex-direction: column;
    border: 1px solid color-mix(in srgb, var(--md-sys-color-outline-variant) 55%, transparent);
    border-radius: var(--radius-card, 16px);
    background: var(--card-surface, var(--md-sys-color-surface-container));
    color: var(--md-sys-color-on-surface);
    -webkit-tap-highlight-color: transparent;
    /* Chips and tonal buttons on the card (see the theme's --card-tonal). */
    --chip-container: var(--card-tonal, var(--md-sys-color-surface-container-highest));
    --button-tonal-container: var(--card-tonal, var(--md-sys-color-surface-container-highest));
  }

  .selected {
    outline: 2px solid var(--md-sys-color-primary);
    outline-offset: 2px;
  }

  /* Keyboard focus adds to the selection ring: a double ring, so focus and selection differ. */
  .card:focus-visible {
    outline: 6px double var(--md-sys-color-primary);
    outline-offset: 1px;
  }

  /* Everything inside scales with the card's width (cqw); the 3:2 area holds header, face, controls. */
  .main {
    display: flex;
    flex-direction: column;
    aspect-ratio: 3 / 2;
    min-block-size: 0;
    padding: clamp(0.625rem, 1.85cqw, 1.75rem);
    --button-height: clamp(2.75rem, 6.75cqw, 5rem);
    --button-icon-size: clamp(1.125rem, 2.8cqw, 2.25rem);
    --button-font-size: clamp(0.875rem, 2.15cqw, 1.5rem);
  }

  /*
   * The face is a size container, so the ring and digits fit whatever room the header and controls
   * leave (a phone card, a 4K card, fullscreen). On the stage inside it, --dial is the ring's
   * diameter: the face's height less a band for the quick-add chips (--below), capped by its width.
   * Timers and stopwatches share it, so their rings are the same size side by side; a stopwatch has
   * no chips and centers its ring in the whole face, half a band lower than a running timer's.
   * Descendants resolve these lengths against the face.
   */
  .face {
    flex: 1 1 0;
    min-block-size: 0;
    margin-block: clamp(0.25rem, 1.2cqw, 1.25rem);
    container: face / size;
  }

  .stage {
    position: relative;
    block-size: 100%;
    --chip-font: clamp(0.75rem, 4.4cqh, 1.375rem);
    --below: calc(var(--chip-font) * 2.4 + 4cqh);
    --dial: max(0px, min(100cqw, 100cqh - var(--below)));
  }

  /* A short face (narrow cards): the chips move beside the ring, which takes the full height. */
  @container face (max-height: 12.5rem) {
    .stage {
      --below: 0px;
    }
  }

  .controls {
    display: grid;
    grid-auto-columns: 1fr;
    grid-auto-flow: column;
    gap: clamp(0.375rem, 1.1cqw, 1rem);
  }

  /* Fullscreen fills the screen instead of keeping 3:2; container queries do the scaling. */
  .card:fullscreen,
  .card:global([data-fullscreen-fallback]) {
    border: none;
    border-radius: 0;
    outline: none;
    background: var(--card-surface, var(--md-sys-color-surface-container));
  }

  .card:global([data-fullscreen-fallback]) {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .card:fullscreen .main,
  .card:global([data-fullscreen-fallback]) .main {
    flex: 1 1 auto;
    aspect-ratio: auto;
  }

  /* Fullscreen is read from across the room: bigger digits inside the same ring. */
  .card:fullscreen .stage,
  .card:global([data-fullscreen-fallback]) .stage {
    --digit-ratio: 0.24;
  }

  :global(:root:has([data-fullscreen-fallback])) {
    overflow: hidden;
  }

  @media (forced-colors: active) {
    .card {
      border-color: CanvasText;
    }

    .selected {
      outline-color: Highlight;
    }

    .card:focus-visible {
      outline-color: Highlight;
    }
  }
</style>
