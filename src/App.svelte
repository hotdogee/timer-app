<!--
  The app: the card grid and its action bar, the undo and update snackbars, the live region, the
  keyboard layer, the command palette, the shortcut cheat sheet, the settings dialog and the
  confirm-delete dialog. App
  owns the UI state that the keyboard layer reads and writes (typed digits, the grid's column
  count, edit mode, rename, the "+ Timer" menu, which dialog is open) and runs the frame loop, the
  per-frame settle and the alarm.

  Settings apply live: the appearance (theme, seed, font, sizes, density) and the language follow
  `settingsStore.device` through effects; the alarm, the shortcuts and the cards read
  `settingsStore.synced`; the "+ Timer" menu and the palette list `presetStore.presets`. The data
  is loaded before mount (main.ts); Settings › Data exports it to a file and imports one through
  `appData.replaceAll`.

  Every way of acting (buttons, keys, palette commands) changes cards through `cardStore`, and the
  app follows the store: deletes leave `cardStore.lastRemoved`, which shows the undo snackbar and
  is announced, and the other announcements are a diff of the card list. Every delete (key,
  button, palette) goes through `deleteCard`, which asks first when "Confirm before delete" is on.
  Starts from a key or a command call `alarm.prime()` inside the gesture (`onStart`), as the Start
  buttons do, so audio and notifications unlock.

  While a card is fullscreen it follows the selection, so the keys always act on the card in view;
  as the overlay (no Fullscreen API) everything else is inert, as native fullscreen makes it.

  Accounts (main.ts starts the session check and the sync connection): while signed in, the action
  bar shows the sync status as a cloud that opens Settings › Account, which is also where the app
  opens after a provider sign-in that failed, so its message is seen. Times the app stamps (the
  export's date included) are app time, which follows the server's clock while signed in.

  Desktop (`state/desktop.svelte.ts`; nothing on the web): the shell hears whether a card runs and
  the close behavior, the tray gets its labels in the app's language, and the global hotkey and
  the tray's "Start or pause the last card" act on the last-used card through the keyboard
  controller. The mini window (the header button, `T`, the palette) opens through the platform:
  a window of its own on desktop, Picture-in-Picture in Chromium. The desktop app's update prompt
  shares the snackbar slot.

  The web app's page is also the site's home page: under the cards it says what the app is and
  links the privacy policy, as Google's brand verification of the sign-in consent screen asks of a
  home page. The desktop app leaves that out (Settings › About links the policy there too).
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'

  import { cards, digits, exportFormat, type DigitBuffer } from './core'
  import { applyLocaleSetting, m } from './i18n'
  import { FALLBACK_ATTRIBUTE, platform } from './platform'
  import { applyUpdate, dismissOfflineReady, dismissUpdate, pwaState } from './pwa.svelte'
  import { createAlarm } from './state/alarm.svelte'
  import { appClock } from './state/app-clock'
  import type { AppData } from './state/app-data.svelte'
  import { authStore } from './state/auth.svelte'
  import { cardStore } from './state/cards.svelte'
  import { startDesktop } from './state/desktop.svelte'
  import {
    createKeyboardController,
    detectKeyPlatform,
    type AppActions,
  } from './state/keyboard.svelte'
  import { presetStore } from './state/presets.svelte'
  import { settingsStore } from './state/settings.svelte'
  import { remoteSync } from './sync/remote.svelte'
  import { PRIVACY_POLICY_URL } from './ui/account/privacy'
  import Announcer from './ui/Announcer.svelte'
  import { announce } from './ui/announce.svelte'
  import ConfirmDialog from './ui/ConfirmDialog.svelte'
  import { frameClock } from './ui/frame-clock.svelte'
  import ActionBar from './ui/grid/ActionBar.svelte'
  import { describeChanges, joinAnnouncements } from './ui/grid/announcements'
  import { cardElement } from './ui/grid/card-element'
  import CardGrid from './ui/grid/CardGrid.svelte'
  import EmptyState from './ui/grid/EmptyState.svelte'
  import KeyboardHelp from './ui/KeyboardHelp.svelte'
  import { openMiniWindow } from './ui/mini/open'
  import CommandPalette from './ui/palette/CommandPalette.svelte'
  import { shortcutLabel } from './ui/palette/shortcuts'
  import Snackbar from './ui/primitives/Snackbar.svelte'
  import type * as SettingsUi from './ui/settings'
  import { applyAppearance } from './ui/theme/apply'
  import UpdatePrompt from './ui/UpdatePrompt.svelte'

  interface Props {
    /** The loaded app data (`startAppData`, in main.ts); Import replaces it. */
    appData: Pick<AppData, 'replaceAll'>
  }

  let { appData }: Props = $props()

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
  /** The settings dialog (⚙, Mod+, or the palette). */
  let settingsOpen = $state(false)
  /**
   * The settings dialog's code (with its controls, about 20 kB gzip), loaded the first time it
   * opens, since startup does not need it. Once loaded it stays mounted (it renders nothing while
   * closed), so it reopens on the last section shown.
   */
  let settingsUi = $state.raw<typeof SettingsUi | null>(null)
  let settingsLoading = false
  /** The section the settings dialog shows; kept between openings. */
  let settingsSection = $state<SettingsUi.SectionId>('appearance')
  /** The action bar's ⚙, where focus goes when Settings closes and its opener is gone. */
  let settingsButton = $state<HTMLButtonElement>()
  /** The card waiting for "Delete …?" to be answered (Confirm before delete). */
  let pendingDelete = $state.raw<{ readonly id: cards.CardId; readonly name: string } | null>(null)
  let confirmOpen = $state(false)

  /** The modifier convention for shortcuts and their labels (Cmd on Apple devices). */
  const keyPlatform = detectKeyPlatform()
  /** The shortcuts: the defaults with the user's rebindings. Stable while the keymap is. */
  const bindings = $derived(settingsStore.bindings)
  /** Durations in the palette follow the time style setting. */
  const timeStyle = $derived(settingsStore.synced.timeStyle)

  const selectedId = $derived(cardStore.list.selectedId)

  // ── Appearance and language ─────────────────────────────────────────────────────────────
  // Startup (main.ts) applies both before mounting; these keep them in step with the settings,
  // from this tab, another tab or an import. Both write only what changed.
  $effect(() => {
    void applyAppearance(settingsStore.device)
  })
  $effect(() => {
    applyLocaleSetting(settingsStore.device.locale)
  })

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
  // It reads the sound, volume, loop, auto-stop and notification settings live.
  const alarm = createAlarm(cardStore, platform, { settings: () => settingsStore.synced })
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
      if (messages.length > 0) announce(joinAnnouncements(messages))
    })
  })

  // ── Undo delete ───────────────────────────────────────────────────────────────────────────
  // Every delete (button, keyboard, palette) leaves `lastRemoved`; the snackbar follows it and
  // forgets it when it times out, so Undo and Ctrl+Z work only while it shows (6 seconds). The
  // delete is announced through the app's live region with the shortcut, which is the quick way
  // to undo from the keyboard; the snackbar itself is not a live region.
  const removed = $derived(cardStore.lastRemoved)
  const undoKeys = $derived(shortcutLabel(bindings, 'undo', keyPlatform))
  const undoHint = $derived(undoKeys === null ? '' : m.delete_undo_hint({ keys: undoKeys }))
  /** The deleted card's name; kept while the snackbar slides out. */
  let removedName = $state('')
  const snackbarMessage = $derived(m.delete_snackbar({ name: removedName }))
  let snackbarHost = $state<HTMLElement>()
  $effect.pre(() => {
    // Keep the last message while the snackbar slides out.
    if (!removed) return
    removedName = removed.card.name
    untrack(() => {
      announce(m.announce_then({ first: snackbarMessage, next: undoHint }))
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

  /**
   * A snackbar button that is about to go away (the update prompt's Install and restart, Try
   * again, Later): when it has the focus, the focus goes back to the selected card, so keyboard and
   * screen-reader users stay with the cards instead of falling to the page.
   */
  function refocusFromSnackbar(): void {
    if (snackbarHost?.contains(document.activeElement) !== true) return
    void tick().then(() => {
      const selected = cardStore.list.selectedId
      if (selected !== null) cardElement(document, selected)?.focus()
    })
  }

  /** Esc after the keyboard layer cleared typed digits: close the rename field, else edit mode. */
  function cancel(): void {
    keepFocusInCard(() => {
      if (renamingId !== null) renamingId = null
      else if (editing) editing = false
    })
  }

  /** Closes every dialog and menu, so the next one opens alone. */
  function closeOverlays(): void {
    timerMenuOpen = false
    paletteOpen = false
    helpOpen = false
    settingsOpen = false
  }

  /** Opens the command palette; one dialog or menu at a time. */
  function openPalette(): void {
    closeOverlays()
    paletteOpen = true
  }

  /** Opens the shortcut cheat sheet (also from the palette, which closes itself first). */
  function openHelp(): void {
    closeOverlays()
    helpOpen = true
  }

  /**
   * Opens the settings dialog (⚙, Mod+, or the palette) on the last section shown, or on `section`
   * (the sync status button opens Account), loading it the first time.
   */
  function openSettings(section?: SettingsUi.SectionId): void {
    closeOverlays()
    if (section !== undefined) settingsSection = section
    settingsOpen = true
    if (settingsUi !== null || settingsLoading) return
    settingsLoading = true
    import('./ui/settings').then(
      (module) => {
        settingsUi = module
      },
      (error: unknown) => {
        // Offline before the app was cached, say. The next try loads it again.
        console.warn('Timer App: could not load the settings', error)
        settingsOpen = false
        settingsLoading = false
      },
    )
  }

  /**
   * Settings closed: the dialog gives focus back to whatever opened it. When that is gone (the
   * cloud button, removed by signing out or deleting the account in Settings › Account), focus
   * would fall to the page; it goes to ⚙ instead, in the same place in the action bar.
   */
  function settingsClosed(): void {
    void tick().then(() => {
      const active = document.activeElement
      if (active === null || active === document.body) settingsButton?.focus()
    })
  }

  // ── Account ──────────────────────────────────────────────────────────────────────────────
  /** The sync status for the action bar's cloud, while signed in; null hides the cloud. */
  const syncStatus = $derived(authStore.status === 'signed-in' ? remoteSync.status : null)

  // Back from a provider sign-in that failed or was cancelled (main.ts started the auth state,
  // which read the failure off the URL): show Settings › Account, where the message is.
  if (untrack(() => authStore.error) === 'oauth') openSettings('account')

  // ── Delete, with "Confirm before delete" ─────────────────────────────────────────────────
  /**
   * Deletes card `id` (the Delete key, a card's delete button, the palette), first asking
   * "Delete …?" when the setting is on. Either way the undo snackbar follows the delete.
   */
  function deleteCard(id: cards.CardId): void {
    const card = untrack(() => cards.findCard(cardStore.list, id))
    if (card === undefined) return
    if (!untrack(() => settingsStore.synced.confirmDelete)) {
      cardStore.remove(id)
      return
    }
    closeOverlays()
    pendingDelete = { id, name: card.name }
    confirmOpen = true
  }

  /** "Delete" in the confirm dialog: the dialog has closed and focus is back on the opener. */
  function confirmDelete(): void {
    const pending = pendingDelete
    pendingDelete = null
    if (pending !== null) cardStore.remove(pending.id)
  }

  function cancelDelete(): void {
    pendingDelete = null
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
    openSettings,
    toggleEditMode,
    startRename,
    toggleFullscreen,
    miniWindow: (id) => {
      void openMiniWindow(id)
    },
    openPresets,
    deleteCard,
    undoRemove,
    cancel,
  }

  // ── Keyboard layer ───────────────────────────────────────────────────────────────────────
  // It also drops typed digits when the selection or the selected card's phase changes. It reads
  // the bindings on every key press, so rebinding applies at once.
  const keyboard = createKeyboardController({
    cardStore,
    platform: keyPlatform,
    get bindings() {
      return settingsStore.bindings
    },
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

  // ── Desktop: the shell, the tray and the global hotkeys ─────────────────────────────────
  // Nothing starts on the web, which has no shell; a web build (`__DESKTOP__` false) leaves the
  // code out.
  const stopDesktop = __DESKTOP__
    ? startDesktop({
        platform,
        list: () => cardStore.list,
        desktop: () => settingsStore.desktop,
        trayLabels: () => ({
          show: m.tray_show(),
          toggleLast: m.tray_toggle_last(),
          quit: m.tray_quit(),
        }),
        toggleLast: () => {
          keyboard.toggleLast()
        },
      })
    : () => undefined
  /** The desktop app's update prompt; none in a web build (the web has the service worker's). */
  const DesktopUpdatePrompt = __DESKTOP__ ? UpdatePrompt : null
  $effect(() => () => {
    stopDesktop()
  })

  // ── PWA: "Update ready" and "Ready to work offline" ──────────────────────────────────────
  // One snackbar at a time: these wait while the undo snackbar shows, and while a dialog is open
  // (the modal makes the page, the snackbar included, inert and silent). An update stays offered
  // until Reload or Later, so keyboard and screen-reader users can reach it; Later waits for the
  // next one. The offline note is brief and has no action.
  const OFFLINE_TIMEOUT_MS = 4_000
  /** Which note the snackbar shows; kept while it slides out. */
  let pwaNotice = $state<'update' | 'offline'>('offline')
  $effect.pre(() => {
    if (pwaState.updateReady) pwaNotice = 'update'
    else if (pwaState.offlineReady) pwaNotice = 'offline'
  })
  const dialogOpen = $derived(paletteOpen || helpOpen || settingsOpen || confirmOpen)
  const pwaOpen = $derived(
    (pwaState.updateReady || pwaState.offlineReady) && removed === null && !dialogOpen,
  )
  const pwaUpdate = $derived(pwaNotice === 'update')
  const pwaMessage = $derived(pwaUpdate ? m.pwa_update_ready() : m.pwa_offline_ready())

  /** Later, Reload (the page reloads into the new version) or the offline note timed out. */
  function closePwaSnackbar(): void {
    if (pwaUpdate) dismissUpdate()
    else dismissOfflineReady()
  }

  // ── Settings › Data: export and import ──────────────────────────────────────────────────
  /** Saves cards, presets and both settings groups as `timer-app-YYYY-MM-DD.json`. */
  function exportData(ui: typeof SettingsUi): void {
    ui.downloadExport(
      exportFormat.createExport({
        exportedAt: appClock(),
        cards: cardStore.cards,
        presets: presetStore.presets,
        settings: { synced: settingsStore.synced, device: settingsStore.device },
      }),
    )
  }

  /**
   * Replaces everything with a validated import file's data, once the user agreed: the cards are
   * settled at the current time, and the device settings in the file apply here too.
   */
  function importData(data: exportFormat.ExportData): void {
    typed = digits.EMPTY
    renamingId = null
    appData.replaceAll(data)
    // The cards are replaced by now. Settings › Data announces the import itself; a diff of every
    // card ("Added …" for each) would only repeat it at length.
    announcedList = untrack(() => cardStore.list)
  }
</script>

<svelte:window onkeydown={keyboard.handleKeydown} />

<main class="app">
  <h1 class="visually-hidden">{m.app_name()}</h1>
  {#if cardStore.cards.length > 0}
    <CardGrid
      {typed}
      ontyped={(buffer: DigitBuffer) => {
        typed = buffer
      }}
      {editing}
      {renamingId}
      onrename={startRename}
      onrenameend={endRename}
      ondelete={deleteCard}
      onstart={onStart}
      isolate={overlayId}
      bind:columns
    />
  {:else}
    <EmptyState />
  {/if}

  <!-- Floating UI, inside the main landmark; out of reach under the fullscreen overlay. -->
  <div class="floating" inert={overlayId !== null}>
    <ActionBar
      {editing}
      ontoggleedit={toggleEditMode}
      onopensettings={() => {
        openSettings()
      }}
      bind:menuOpen={timerMenuOpen}
      {syncStatus}
      onopenaccount={() => {
        openSettings('account')
      }}
      bind:settingsButton
    />

    <div class="snackbar-host" bind:this={snackbarHost}>
      <Snackbar
        open={removed !== null}
        message={snackbarMessage}
        hint={undoHint}
        live={false}
        actionLabel={m.delete_undo()}
        onaction={undoRemove}
        key={removed}
        onclose={(reason: 'timeout' | 'action' | 'dismiss') => {
          if (reason === 'timeout') cardStore.forgetRemoved()
        }}
      />
      <Snackbar
        open={pwaOpen}
        message={pwaMessage}
        actionLabel={pwaUpdate ? m.pwa_reload() : ''}
        onaction={() => {
          void applyUpdate()
        }}
        dismissLabel={pwaUpdate ? m.pwa_later() : ''}
        timeout={pwaUpdate ? 0 : OFFLINE_TIMEOUT_MS}
        key={pwaNotice}
        onclose={closePwaSnackbar}
      />
      {#if DesktopUpdatePrompt !== null && platform.updater.supported}
        <!-- The desktop app's update prompt (the web has the service worker's, above). -->
        <DesktopUpdatePrompt
          blocked={removed !== null || dialogOpen || pwaOpen}
          onleave={refocusFromSnackbar}
        />
      {/if}
    </div>
  </div>

  {#if !__DESKTOP__}
    <!-- The home page's note on the app and its privacy policy; inert under the overlay too. -->
    <footer class="about" inert={overlayId !== null}>
      <p>{m.home_about({ app: m.app_name() })}</p>
      <p>
        <a href={PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer">
          {m.home_privacy()}
        </a>
      </p>
    </footer>
  {/if}
</main>

<Announcer />

<CommandPalette
  bind:open={paletteOpen}
  context={{
    cardStore,
    actions,
    presets: presetStore.presets,
    editing,
    timeStyle,
    onStart,
    takeTyped,
    miniWindow: platform.windows.supported,
  }}
  {bindings}
  platform={keyPlatform}
/>
<KeyboardHelp bind:open={helpOpen} {bindings} platform={keyPlatform} />
<ConfirmDialog
  bind:open={confirmOpen}
  title={m.confirm_delete_title({ name: pendingDelete?.name ?? '' })}
  confirmLabel={m.confirm_delete_confirm()}
  cancelLabel={m.confirm_delete_cancel()}
  onconfirm={confirmDelete}
  oncancel={cancelDelete}
/>
{#if settingsUi !== null}
  {@const ui = settingsUi}
  <ui.SettingsDialog
    bind:open={settingsOpen}
    bind:section={settingsSection}
    onclose={settingsClosed}
    {settingsStore}
    {presetStore}
    cardCount={cardStore.cards.length}
    onexport={() => {
      exportData(ui)
    }}
    onimport={importData}
    {keyPlatform}
  />
{/if}

<style>
  .app {
    padding: var(--space-4, 1rem);
    /* Room for the floating action bar under the last row. */
    padding-block-end: calc(var(--space-4, 1rem) * 2 + 3.5rem);
  }

  .floating {
    display: contents;
  }

  /* Under the last row, above the action bar's band (the padding above). */
  .about {
    max-inline-size: 40rem;
    margin: var(--space-6, 2rem) auto 0;
    text-align: center;
    font-size: 0.875rem;
    line-height: 1.25rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .about p {
    margin: 0;
  }

  .about a {
    display: inline-flex;
    align-items: center;
    min-block-size: var(--touch-target, 44px);
    color: var(--md-sys-color-primary);
    font-weight: 500;
    text-underline-offset: 0.15em;
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
