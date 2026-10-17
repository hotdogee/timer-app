<!--
  @component
  The responsive card grid (spec › Layout, Windows Clock style). Columns follow the width: each is
  at least 22rem, and the grid is at most `count × 49rem` wide and centered, so one card is never
  wider than 48rem. Cards animate in, out and on reorder (`animate:flip`), all reduced-motion aware.

  It reports its column count (`bind:columns`, from the resolved `grid-template-columns`) for
  arrow-key navigation and runs drag reordering in edit mode. Focus survives the list changing
  under it: a moved card keeps it, and a deleted card hands it to the selected card. While one
  card is the fullscreen overlay (`isolate`), the other cards are inert, as native fullscreen
  makes them.
-->
<script lang="ts">
  import { untrack } from 'svelte'
  import { flip, type AnimationConfig, type FlipParams } from 'svelte/animate'
  import { cubicOut } from 'svelte/easing'
  import { prefersReducedMotion } from 'svelte/motion'
  import { scale, type TransitionConfig } from 'svelte/transition'

  import { cards, digits, type DigitBuffer } from '../../core'
  import { cardStore } from '../../state/cards.svelte'
  import StopwatchCard from '../card/StopwatchCard.svelte'
  import TimerCard from '../card/TimerCard.svelte'
  import { cardElement } from './card-element'
  import { dragTranslation, dropIndex, edgeScroll, type Point, type Rect } from './drag-reorder'

  interface Props {
    /** Digits typed for the selected timer. */
    typed?: DigitBuffer
    /** A card used or discarded the typed digits. */
    ontyped?: ((buffer: DigitBuffer) => void) | undefined
    /** Edit mode: rename fields, delete buttons, drag handles. */
    editing?: boolean
    /** The card whose name field is open outside edit mode (F2), if any. */
    renamingId?: cards.CardId | null
    onrenameend?: (() => void) | undefined
    /** Runs synchronously inside a timer's Start click (audio unlock, notification permission). */
    onstart?: (() => void) | undefined
    /** How many columns the grid shows now. Bindable; read it for up/down navigation. */
    columns?: number
    /** The card shown as the fullscreen overlay, if any: every other card is inert meanwhile. */
    isolate?: cards.CardId | null
  }

  let {
    typed = digits.EMPTY,
    ontyped,
    editing = false,
    renamingId = null,
    onrenameend,
    onstart,
    columns = $bindable(1),
    isolate = null,
  }: Props = $props()

  let grid = $state<HTMLElement>()

  const count = $derived(cardStore.cards.length)
  const selectedId = $derived(cardStore.list.selectedId)

  // ── Columns ────────────────────────────────────────────────────────────────────────────────
  // auto-fit collapses unused tracks to 0px; only tracks with width hold cards.
  function measureColumns(): void {
    if (!grid) return
    const tracks = getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter((track) => Number.parseFloat(track) > 0).length
    columns = Math.max(1, tracks)
  }

  $effect(() => {
    const element = grid
    if (!element) return
    const observer = new ResizeObserver(() => {
      measureColumns()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  })

  // The card count changes how many tracks hold cards without always resizing the grid.
  $effect(() => {
    void count
    untrack(measureColumns)
  })

  // ── Focus repair ──────────────────────────────────────────────────────────────────────────
  // A list change can take focus away: the keyed {#each} moves a reordered card's element, which
  // drops focus in Chromium, and a deleted card's element goes inert, then away. Note where focus
  // was before the DOM update and repair it after: a moved element gets focus back (so arrow keys
  // on a drag handle keep moving the card), and a deleted card hands it to the selected card.
  // A control replaced inside a card that stays is the card's own business (Card.svelte).
  let focusBefore: { readonly element: HTMLElement; readonly cardId: string | null } | null = null

  $effect.pre(() => {
    void cardStore.list
    untrack(() => {
      const active = document.activeElement
      focusBefore =
        active instanceof HTMLElement && grid?.contains(active) === true
          ? {
              element: active,
              cardId: active.closest('[data-card-id]')?.getAttribute('data-card-id') ?? null,
            }
          : null
    })
  })

  $effect(() => {
    const list = cardStore.list
    untrack(() => {
      const before = focusBefore
      focusBefore = null
      if (before === null) return
      const active = document.activeElement
      const lost = active === null || active === document.body || active.closest('[inert]') !== null
      if (!lost) return
      if (before.element.isConnected && before.element.closest('[inert]') === null) {
        before.element.focus({ preventScroll: true })
      } else if (before.cardId !== null && cards.findCard(list, before.cardId) === undefined) {
        if (list.selectedId !== null) cardElement(grid, list.selectedId)?.focus()
      }
    })
  })

  // ── Transitions ───────────────────────────────────────────────────────────────────────────
  const motion = $derived(prefersReducedMotion.current ? 0 : 1)

  /**
   * `flip`, except for a cell with no size: a card shown fullscreen leaves its cell empty, and
   * flipping from or to an empty box would scale by NaN.
   */
  function reflow(
    node: Element,
    rects: { from: DOMRect; to: DOMRect },
    params: FlipParams,
  ): AnimationConfig {
    const { from, to } = rects
    if (from.width === 0 || from.height === 0 || to.width === 0 || to.height === 0) {
      return { duration: 0 }
    }
    return flip(node, rects, params)
  }

  /**
   * Fades a deleted card out after taking it out of the flow at its current place, so the other
   * cards reflow (and flip) at once instead of jumping when the fade ends.
   */
  function leave(node: HTMLElement): TransitionConfig {
    const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = node
    Object.assign(node.style, {
      position: 'absolute',
      left: `${offsetLeft}px`,
      top: `${offsetTop}px`,
      width: `${offsetWidth}px`,
      height: `${offsetHeight}px`,
      pointerEvents: 'none',
    })
    return {
      duration: 150 * motion,
      easing: cubicOut,
      css: (t) => `opacity: ${t}; transform: scale(${0.94 + 0.06 * t})`,
    }
  }

  // ── Drag reorder (edit mode) ──────────────────────────────────────────────────────────────
  interface Drag {
    readonly id: cards.CardId
    readonly pointerId: number
    /** Card slots in page coordinates, measured once when the drag starts. */
    readonly slots: readonly Rect[]
    /** Where the pointer holds the card, from the card's top-left corner. */
    readonly grab: Point
    /** The index the card started at (Esc puts it back) and the one it has now. */
    readonly origin: number
    readonly index: number
    readonly point: Point
  }

  let drag = $state.raw<Drag | null>(null)
  const offset = $derived(
    drag ? dragTranslation(drag.slots, drag.index, drag.point, drag.grab) : { x: 0, y: 0 },
  )

  function pagePoint(event: PointerEvent): Point {
    return { x: event.pageX, y: event.pageY }
  }

  function startDrag(id: cards.CardId, event: PointerEvent): void {
    if (!grid || drag !== null || event.button !== 0) return
    const cells = [...grid.querySelectorAll<HTMLElement>(':scope > .cell:not([inert])')]
    const slots = cells.map((cell) => {
      const rect = cell.getBoundingClientRect()
      return {
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        width: rect.width,
        height: rect.height,
      }
    })
    const index = cardStore.cards.findIndex((card) => card.id === id)
    const slot = slots[index]
    if (slot === undefined || slots.length !== count) return
    // No text selection or native drag; the card still gets selected.
    event.preventDefault()
    cardStore.select(id)
    const point = pagePoint(event)
    drag = {
      id,
      pointerId: event.pointerId,
      slots,
      grab: { x: point.x - slot.left, y: point.y - slot.top },
      origin: index,
      index,
      point,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onDragKeydown, { capture: true })
  }

  function onPointerMove(event: PointerEvent): void {
    const current = drag
    if (current?.pointerId !== event.pointerId) return
    const scroll = edgeScroll(event.clientY, window.innerHeight)
    if (scroll !== 0) window.scrollBy(0, scroll)
    const point = pagePoint(event)
    const index = dropIndex(current.slots, point, current.index)
    if (index !== current.index) cardStore.move(current.id, index)
    drag = { ...current, index, point }
  }

  function endDrag(): void {
    drag = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    window.removeEventListener('keydown', onDragKeydown, { capture: true })
  }

  function onPointerUp(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) endDrag()
  }

  /** A cancelled drag (Esc, or the browser took the pointer) puts the card back. */
  function cancelDrag(): void {
    const current = drag
    if (current === null) return
    cardStore.move(current.id, current.origin)
    endDrag()
  }

  function onPointerCancel(event: PointerEvent): void {
    if (drag?.pointerId === event.pointerId) cancelDrag()
  }

  function onDragKeydown(event: KeyboardEvent): void {
    // While dragging, keys must not start timers; Esc cancels the drag.
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') cancelDrag()
  }

  $effect(() => () => {
    if (drag !== null) endDrag()
  })

  /** Arrow keys on a drag handle move that card one step, as Ctrl+Arrow does. */
  function step(id: cards.CardId, direction: cards.Direction): void {
    cardStore.moveNeighbor(id, direction, columns)
  }
</script>

<div class="grid-wrap" role="grid" aria-label="Cards">
  <div
    bind:this={grid}
    class={['grid', { dragging: drag !== null }]}
    role="row"
    style:--count={Math.max(1, count)}
  >
    {#each cardStore.cards as card (card.id)}
      {@const dragged = drag?.id === card.id}
      <div
        class={['cell', { dragged }]}
        role="none"
        style:transform={dragged ? `translate(${offset.x}px, ${offset.y}px)` : undefined}
        animate:reflow={{ duration: dragged ? 0 : 250 * motion, easing: cubicOut }}
        in:scale={{ start: 0.92, duration: 200 * motion, easing: cubicOut }}
        out:leave
      >
        {#if card.kind === 'timer'}
          <TimerCard
            {card}
            typed={card.id === selectedId ? typed : digits.EMPTY}
            {ontyped}
            {onstart}
            selected={card.id === selectedId}
            {editing}
            renaming={card.id === renamingId}
            inert={isolate !== null && isolate !== card.id}
            {onrenameend}
            ondragstart={(event: PointerEvent) => {
              startDrag(card.id, event)
            }}
            onstep={(direction: cards.Direction) => {
              step(card.id, direction)
            }}
          />
        {:else}
          <StopwatchCard
            {card}
            selected={card.id === selectedId}
            {editing}
            renaming={card.id === renamingId}
            inert={isolate !== null && isolate !== card.id}
            {onrenameend}
            ondragstart={(event: PointerEvent) => {
              startDrag(card.id, event)
            }}
            onstep={(direction: cards.Direction) => {
              step(card.id, direction)
            }}
          />
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .grid {
    position: relative;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    align-items: start;
    gap: var(--space-4, 1rem);
    /* n cards of at most 48rem plus the gaps between them: a lone card is never wider than 48rem. */
    max-inline-size: calc(var(--count, 1) * 49rem - 1rem);
    margin-inline: auto;
  }

  .cell {
    min-inline-size: 0;
    transition: transform var(--duration-medium, 300ms) var(--easing-standard, ease);
  }

  .dragging {
    user-select: none;
    -webkit-user-select: none;
  }

  .dragged {
    position: relative;
    z-index: 2;
    transition: none;
    cursor: grabbing;
  }

  .dragged > :global(.card) {
    box-shadow: var(--shadow-3);
  }
</style>
