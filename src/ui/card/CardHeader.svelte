<!--
  @component
  A card's header: type icon and name on the left; mute, fullscreen and the mini-window button on
  the right (the mini window stays hidden until the desktop milestone). In edit mode the name
  becomes a text field (Enter or leaving the field saves, Esc reverts) and a drag handle and a
  delete button appear. `renaming` shows the field outside edit mode too (F2) and focuses it.
  The type icon is decorative: the card's description says its kind.
-->
<script lang="ts">
  import type { Attachment } from 'svelte/attachments'

  import type { cards } from '../../core'
  import { cardStore } from '../../state/cards.svelte'
  import { Icon, IconButton } from '../primitives'

  interface Props {
    card: cards.Card
    editing: boolean
    renaming: boolean
    /** Whether the card is shown fullscreen. */
    fullscreen: boolean
    ontogglefullscreen: () => void
    /** The rename field closed; `refocus` asks the card to take focus back (Enter, Esc). */
    onrenameend: (refocus: boolean) => void
    ondragstart?: ((event: PointerEvent) => void) | undefined
    onstep?: ((direction: cards.Direction) => void) | undefined
  }

  let {
    card,
    editing,
    renaming,
    fullscreen,
    ontogglefullscreen,
    onrenameend,
    ondragstart,
    onstep,
  }: Props = $props()

  const isTimer = $derived(card.kind === 'timer')

  // The field's text; follows the card's name until the user types, then holds the draft.
  let draft = $derived(card.name)
  let field = $state<HTMLInputElement>()

  $effect(() => {
    if (!renaming || !field) return
    field.focus()
    field.select()
  })

  /**
   * Text typed since the last save or revert, or null. A plain variable, because the field's
   * teardown reads it: teardowns see `$state` as it was before the change that removed the field,
   * so `draft` there would still hold text that Esc had just reverted.
   */
  let unsaved: string | null = null

  /** Saves the text; a blank or unchanged one keeps the name (and the field shows it again). */
  function commit(text: string = draft): void {
    const name = text.trim()
    if (name !== '' && name !== card.name) cardStore.rename(card.id, name)
    draft = card.name
    unsaved = null
  }

  function onFieldKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      commit()
      onrenameend(true)
    } else if (event.key === 'Escape') {
      draft = card.name
      unsaved = null
      onrenameend(true)
    } else {
      return
    }
    // The field owns these keys: they must not also start timers or leave edit mode.
    event.preventDefault()
    event.stopPropagation()
  }

  /** Saves a draft that is still in the field when edit mode ends and the field goes away. */
  const saveOnRemove: Attachment<HTMLInputElement> = () => () => {
    if (unsaved !== null) commit(unsaved)
  }

  const STEP_KEYS: Readonly<Record<string, cards.Direction>> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
  }

  function onHandleKeydown(event: KeyboardEvent): void {
    const direction = STEP_KEYS[event.key]
    if (direction === undefined || event.ctrlKey || event.altKey || event.metaKey) return
    event.preventDefault()
    event.stopPropagation()
    onstep?.(direction)
  }
</script>

<header class={['header', { editing: editing || renaming }]}>
  {#if editing}
    <button
      type="button"
      class="handle"
      aria-label="Move {card.name}"
      title="Drag to move, or use the arrow keys"
      onpointerdown={(event) => ondragstart?.(event)}
      onkeydown={onHandleKeydown}
    >
      <Icon name="drag_indicator" />
    </button>
  {/if}

  <span class="type">
    <Icon name={isTimer ? 'hourglass_top' : 'timer'} />
  </span>

  {#if editing || renaming}
    <input
      bind:this={field}
      {@attach saveOnRemove}
      class="name-field"
      type="text"
      aria-label="Card name"
      autocomplete="off"
      spellcheck="false"
      enterkeyhint="done"
      maxlength="80"
      value={draft}
      oninput={(event) => {
        draft = event.currentTarget.value
        unsaved = draft
      }}
      onkeydown={onFieldKeydown}
      onblur={() => {
        commit()
        if (renaming) onrenameend(false)
      }}
    />
  {:else}
    <h2 class="name" title={card.name}>{card.name}</h2>
  {/if}

  <div class="actions">
    {#if editing}
      <IconButton
        icon="delete"
        label="Delete {card.name}"
        class="delete"
        onclick={() => {
          cardStore.remove(card.id)
        }}
      />
    {/if}
    <IconButton
      icon={card.muted ? 'volume_off' : 'volume_up'}
      label="Mute"
      pressed={card.muted}
      onclick={() => {
        cardStore.setMuted(card.id, !card.muted)
      }}
    />
    <IconButton
      icon={fullscreen ? 'fullscreen_exit' : 'fullscreen'}
      label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      onclick={ontogglefullscreen}
    />
    <!-- Always-on-top mini window: desktop milestone (M5). -->
    <IconButton
      icon="picture_in_picture_alt"
      label="Mini window"
      hidden
      data-feature="mini-window"
    />
  </div>
</header>

<style>
  .header {
    display: flex;
    align-items: center;
    gap: var(--space-2, 0.5rem);
    min-block-size: clamp(2.25rem, 5.5cqw, 4rem);
    font-size: clamp(0.875rem, 2.3cqw, 1.75rem);
    /* Header icons are primary, as in the reference card. */
    --icon-button-color: var(--md-sys-color-primary);
    --icon-button-pressed-color: var(--md-sys-color-primary);
    --icon-button-icon-size: clamp(1.25rem, 3.1cqw, 2.25rem);
  }

  .type {
    display: inline-flex;
    flex: none;
    font-size: clamp(1.25rem, 3.1cqw, 2.25rem);
    color: var(--md-sys-color-on-surface);
  }

  .name {
    flex: 1;
    min-inline-size: 0;
    margin: 0;
    overflow: hidden;
    font-size: inherit;
    font-weight: 500;
    line-height: 1.3;
    letter-spacing: 0.01em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name-field {
    flex: 1;
    min-inline-size: 0;
    /* A full touch target, but the header row stays as short as the reference's (as .actions). */
    block-size: max(var(--touch-target, 44px), 2.2em);
    margin-block: -0.25rem;
    padding-block: 0;
    padding-inline: 0.6em;
    border: 1px solid var(--md-sys-color-outline);
    border-radius: var(--radius-small, 8px);
    background: var(--card-tonal, var(--md-sys-color-surface-container-highest));
    color: var(--md-sys-color-on-surface);
    font-size: inherit;
    font-weight: 500;
  }

  .name-field:focus-visible {
    outline-offset: 0;
    border-color: var(--md-sys-color-primary);
  }

  .actions {
    position: relative;
    /* Above the face, so a chip's invisible hit-area extension never covers these buttons. */
    z-index: 1;
    display: flex;
    flex: none;
    align-items: center;
    margin-inline-start: auto;
    /* 44px hit areas, but the header row stays as short as the reference's. */
    margin-block: -0.25rem;
  }

  .actions :global(.delete) {
    --icon-button-color: var(--md-sys-color-error);
  }

  .handle {
    display: inline-grid;
    flex: none;
    place-items: center;
    inline-size: var(--touch-target, 44px);
    block-size: var(--touch-target, 44px);
    margin-block: -0.25rem;
    margin-inline-start: -0.5rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-size: clamp(1.25rem, 3.1cqw, 2.25rem);
    cursor: grab;
    touch-action: none;
  }

  .handle:hover {
    background: color-mix(in srgb, currentColor 8%, transparent);
  }

  .handle:active {
    cursor: grabbing;
  }

  /* A narrow card in edit mode: the name field needs the type icon's room. */
  @container card (max-width: 20rem) {
    .editing .type {
      display: none;
    }
  }

  @media (forced-colors: active) {
    .name-field {
      border-color: CanvasText;
    }
  }
</style>
