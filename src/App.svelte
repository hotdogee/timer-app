<!--
  The app: the card grid and its action bar, the undo snackbar, the live region, the keyboard
  layer, the command palette and the shortcut cheat sheet. App owns the UI state that the keyboard
  layer reads and writes (typed digits, the grid's column count, edit mode, rename, the "+ Timer"
  menu, which dialog is open) and runs the frame loop, the per-frame settle and the alarm.

  Every way of acting (buttons, keys, palette commands) changes cards through `cardStore`, and the
  app follows the store: deletes leave `cardStore.lastRemoved`, which shows the undo snackbar and
  is announced, and the other announcements are a diff of the card list. Starts from a key or a
  command call `alarm.prime()` inside the gesture (`onStart`), as the Start buttons do, so audio
  and notifications unlock.

  While a card is fullscreen it follows the selection, so the keys always act on the card in view;
  as the overlay (no Fullscreen API) everything else is inert, as native fullscreen makes it.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'

  import { cards, digits, keymap, type DigitBuffer } from './core'
  import { FALLBACK_ATTRIBUTE, platform } from './platform'
  import { createAlarm } from './state/alarm.svelte'
  import { cardStore } from './state/cards.svelte'
  import {
    createKeyboardController,
    detectKeyPlatform,
    type AppActions,
  } from './state/keyboard.svelte'
  import { BUILTIN_PRESETS } from './state/presets'
  import Announcer from './ui/Announcer.svelte'
  import { announce } from './ui/announce.svelte'
  import { frameClock } from './ui/frame-clock.svelte'
  import ActionBar from './ui/grid/ActionBar.svelte'
  import { describeChanges } from './ui/grid/announcements'
  import { cardElement } from './ui/grid/card-element'
  import CardGrid from './ui/grid/CardGrid.svelte'
  import EmptyState from './ui/grid/EmptyState.svelte'
  import KeyboardHelp from './ui/KeyboardHelp.svelte'
  import CommandPalette from './ui/palette/CommandPalette.svelte'
  import { shortcutLabel } from './ui/palette/shortcuts'
  import { Snackbar } from './ui/primitives'

  /** Digits typed for the selected timer (spec › Digit entry). The keyboard layer sets them. */
  let typed = $state<DigitBuffer>(digits.EMPTY)
  /** How many columns the grid shows, for up/down selection. Kept current by the grid. */
  let columns = $state(1)
  /** Edit mode (✎ or E): rename fields, delete buttons and drag handles on every card. */
  let editing = $state(false)
  /** The card whose name field is open outside edit mode (F2). */
  let renamingId = $state<cards.CardId | null>(null)
  /** The "+ Timer" menu (the Presets shortcut opens it). */
  let timerMenuOpen = $state(false)
  /** The command palette (Mod+K). */
  let paletteOpen = $state(false)
  /** The keyboard shortcut cheat sheet (?). */
  let helpOpen = $state(false)

  /** The modifier convention for shortcuts and their labels (Cmd on Apple devices). */
  const keyPlatform = detectKeyPlatform()
  /** The shortcuts. Settings make them rebindable in M3. */
  const bindings = keymap.DEFAULT_BINDINGS

  const selectedId = $derived(cardStore.list.selectedId)

  // ── Frame loop ─────────────────────────────────────────────────────────────────────────────
  // One requestAnimationFrame loop for the page, running only while some display changes.
  const animating = $derived(cards.anyNeedsFrames(cardStore.list))
  $effect(() => {
    if (!animating) return
    frameClock.setActive(true)
    return () => {
      frameClock.setActive(false)
    }
  })

  // Every frame: timers whose end has come start ringing, dated from their real end. The store
  // reads its list untracked, so this effect follows the clock only.
  $effect(() => {
    cardStore.settle(frameClock.now)
  })

  // ── Alarm: sound, notifications, background wake-up ──────────────────────────────────────
  const alarm = createAlarm(cardStore, platform)
  $effect(() => () => {
    alarm.destroy()
  })

  // ── Screen-reader announcements ───────────────────────────────────────────────────────────
  let announcedList = untrack(() => cardStore.list)
  /** A card being restored by undo, announced as "Restored …" rather than "Added …". */
  let restoredId: cards.CardId | null = null
  $effect(() => {
    const list = cardStore.list
    untrack(() => {
      const messages = describeChanges(announcedList, list, restoredId)
      announcedList = list
      restoredId = null
      if (messages.length > 0) announce(messages.join('. '))
    })
  })

  // ── Undo delete ───────────────────────────────────────────────────────────────────────────
  // Every delete (button, keyboard, palette) leaves `lastRemoved`; the snackbar follows it and
  // forgets it when it times out, so Undo and Ctrl+Z work only while it shows (6 seconds). The
  // delete is announced through the app's live region with the shortcut, which is the quick way
  // to undo from the keyboard; the snackbar itself is not a live region.
  const removed = $derived(cardStore.lastRemoved)
  const undoKeys = shortcutLabel(bindings, 'undo', keyPlatform)
  const undoHint = undoKeys === null ? '' : `Press ${undoKeys} to undo.`
  let snackbarMessage = $state('')
  let snackbarHost = $state<HTMLElement>()
  $effect.pre(() => {
    // Keep the last message while the snackbar slides out.
    if (!removed) return
    const message = `Deleted ${removed.card.name}`
    snackbarMessage = message
    untrack(() => {
      announce(`${message}. ${undoHint}`)
    })
  })

  // ── Fullscreen ─────────────────────────────────────────────────────────────────────────────
  let fullscreenElement = $state<Element | null>(null)
  $effect(() => {
    fullscreenElement = platform.fullscreen.element
    return platform.fullscreen.onChange((element) => {
      fullscreenElement = element
    })
  })

  /** The card shown as the overlay (no Fullscreen API), which makes everything else inert. */
  const overlayId = $derived(
    fullscreenElement?.hasAttribute(FALLBACK_ATTRIBUTE) === true
      ? fullscreenElement.getAttribute('data-card-id')
      : null,
  )

  // While a card is fullscreen, show the selected one: arrows, N and undo then act on the card in
  // view. This runs within the key press's activation window, so the browser allows the switch.
  $effect(() => {
    const id = selectedId
    const shownId = fullscreenElement?.getAttribute('data-card-id') ?? null
    if (id === null || shownId === null || shownId === id) return
    untrack(() => {
      const element = cardElement(document, id)
      if (element) void platform.fullscreen.enter(element)
    })
  })

  // ── UI actions for the keyboard controller and the command palette ───────────────────────
  /**
   * Runs `change` (which may remove the focused control, such as a delete button or a name field
   * when edit mode ends) and then, if focus fell to the page, gives it to the card it was in.
   */
  function keepFocusInCard(change: () => void): void {
    const owner = document.activeElement?.closest('[data-card-id]')
    const id = owner?.getAttribute('data-card-id') ?? null
    change()
    if (id === null) return
    void tick().then(() => {
      const active = document.activeElement
      if (active === null || active === document.body) cardElement(document, id)?.focus()
    })
  }

  function toggleEditMode(): void {
    keepFocusInCard(() => {
      editing = !editing
      renamingId = null
    })
  }

  function startRename(id: cards.CardId): void {
    cardStore.select(id)
    renamingId = id
  }

  function endRename(): void {
    renamingId = null
  }

  function toggleFullscreen(id: cards.CardId): void {
    const element = cardElement(document, id)
    if (element) void platform.fullscreen.toggle(element)
  }

  function openPresets(): void {
    timerMenuOpen = true
  }

  /** Puts the last deleted card back, selected, and focuses it when focus had nowhere to be. */
  function undoRemove(): void {
    const last = cardStore.lastRemoved
    if (last === null) return
    const active = document.activeElement
    const refocus =
      active === null ||
      active === document.body ||
      snackbarHost?.contains(active) === true ||
      active.closest('[data-card-id]') !== null ||
      active.closest('[data-empty-state]') !== null
    restoredId = last.card.id
    if (!cardStore.undoRemove()) {
      restoredId = null
      return
    }
    if (refocus) {
      void tick().then(() => {
        cardElement(document, last.card.id)?.focus()
      })
    }
  }

  /** Esc after the keyboard layer cleared typed digits: close the rename field, else edit mode. */
  function cancel(): void {
    keepFocusInCard(() => {
      if (renamingId !== null) renamingId = null
      else if (editing) editing = false
    })
  }

  /** Opens the command palette; one dialog or menu at a time. */
  function openPalette(): void {
    timerMenuOpen = false
    helpOpen = false
    paletteOpen = true
  }

  /** Opens the shortcut cheat sheet (also from the palette, which closes itself first). */
  function openHelp(): void {
    timerMenuOpen = false
    paletteOpen = false
    helpOpen = true
  }

  /** Inside a key press or command that started a timer: unlock audio, ask for notifications. */
  function onStart(): void {
    alarm.prime()
  }

  /** Hands over the typed digits for one action and clears them (the palette's Start/Pause). */
  function takeTyped(): DigitBuffer {
    const buffer = typed
    typed = digits.EMPTY
    return buffer
  }

  /** The UI actions the keyboard layer and the palette need beyond the card store. */
  const actions: AppActions = {
    openPalette,
    openHelp,
    toggleEditMode,
    startRename,
    toggleFullscreen,
    miniWindow: () => {
      // Always-on-top mini window: desktop milestone (M5).
    },
    openPresets,
    undoRemove,
    cancel,
  }

  // ── Keyboard layer ───────────────────────────────────────────────────────────────────────
  // It also drops typed digits when the selection or the selected card's phase changes.
  const keyboard = createKeyboardController({
    cardStore,
    platform: keyPlatform,
    bindings,
    getColumns: () => columns,
    getTyped: () => typed,
    setTyped: (buffer) => {
      typed = buffer
    },
    actions,
    onStart,
  })
  $effect(() => () => {
    keyboard.destroy()
  })
</script>

<svelte:window onkeydown={keyboard.handleKeydown} />

<main class="app">
  <h1 class="visually-hidden">Timer App</h1>
  {#if cardStore.cards.length > 0}
    <CardGrid
      {typed}
      ontyped={(buffer: DigitBuffer) => {
        typed = buffer
      }}
      {editing}
      {renamingId}
      onrenameend={endRename}
      onstart={onStart}
      isolate={overlayId}
      bind:columns
    />
  {:else}
    <EmptyState />
  {/if}

  <!-- Floating UI, inside the main landmark; out of reach under the fullscreen overlay. -->
  <div class="floating" inert={overlayId !== null}>
    <ActionBar {editing} ontoggleedit={toggleEditMode} bind:menuOpen={timerMenuOpen} />

    <div class="snackbar-host" bind:this={snackbarHost}>
      <Snackbar
        open={removed !== null}
        message={snackbarMessage}
        hint={undoHint}
        live={false}
        actionLabel="Undo"
        onaction={undoRemove}
        key={removed}
        onclose={(reason: 'timeout' | 'action') => {
          if (reason === 'timeout') cardStore.forgetRemoved()
        }}
      />
    </div>
  </div>
</main>

<Announcer />

<CommandPalette
  bind:open={paletteOpen}
  context={{ cardStore, actions, presets: BUILTIN_PRESETS, editing, onStart, takeTyped }}
  {bindings}
  platform={keyPlatform}
/>
<KeyboardHelp bind:open={helpOpen} {bindings} platform={keyPlatform} />

<style>
  .app {
    padding: var(--space-4, 1rem);
    /* Room for the floating action bar under the last row. */
    padding-block-end: calc(var(--space-4, 1rem) * 2 + 3.5rem);
  }

  .floating {
    display: contents;
  }

  .snackbar-host {
    --snackbar-offset: var(--space-4, 1rem);
  }

  /* On narrow screens the snackbar would cover the action bar: lift it above. */
  @media (max-width: 37.5rem) {
    .snackbar-host {
      --snackbar-offset: calc(var(--space-4, 1rem) + 4rem);
    }
  }
</style>
