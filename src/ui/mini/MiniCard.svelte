<!--
  @component
  One card, compact, for the mini window (spec › Card header, Mini window): a header with the
  card's type icon and name (the window's drag region on desktop), the always-on-top pin
  (`pinnable`: the desktop window; the web's Picture-in-Picture window is always on top) and a
  close button; the ring with the digits, sized to the window by container queries; and the card's
  main buttons (`miniControls`): Start or Pause (Resume, Dismiss), Reset or Restart, and `+1:00`
  for a timer; Start or Pause (Resume), Lap and Reset for a stopwatch. Wide windows put the buttons
  beside the ring, tall ones under it.

  Keys, in the window it is drawn in (`view`), follow the user's bindings: Space starts or pauses,
  Enter starts or dismisses, R resets, L laps, Esc closes. The digits run on `view`'s own animation
  frames, so they keep moving while the main window is hidden. If the card is deleted, it says so
  and closes the window after two seconds (unless the card comes back meanwhile).

  The card's state is the app's (`cardStore`): in the desktop window, the page's own copy, kept in
  step with the main window's through the shared storage; in Picture-in-Picture, the main window's
  own. `announceChanges` announces the card's changes in its own live region (the desktop page,
  which has no app around it to do that).

  ```svelte
  <MiniCard cardId={id} pinnable onclose={() => platform.windows.close()} />
  ```
-->
<script lang="ts">
  import { untrack } from 'svelte'

  import { cards, digits, formatElapsed, stopwatch, timer, type FrameScheduler } from '../../core'
  import { m } from '../../i18n'
  import { platform, unlockAudioOnGestures } from '../../platform'
  import { appClock } from '../../state/app-clock'
  import { cardStore } from '../../state/cards.svelte'
  import { detectKeyPlatform } from '../../state/keyboard.svelte'
  import { settingsStore } from '../../state/settings.svelte'
  import { runTimer, startTimer, toggleTimer } from '../../state/timer-actions'
  import Announcer from '../Announcer.svelte'
  import { announce } from '../announce.svelte'
  import Digits from '../card/Digits.svelte'
  import { cardStatus, dotTurn, quickAddLabel, timerReadout, timerView } from '../card/display'
  import Ring from '../card/Ring.svelte'
  import { createFrameClock } from '../frame-clock.svelte'
  import { describeChanges, joinAnnouncements } from '../grid/announcements'
  import Button from '../primitives/Button.svelte'
  import Icon from '../primitives/Icon.svelte'
  import IconButton from '../primitives/IconButton.svelte'
  import { ICON_VIEW_BOX, type IconName } from '../primitives/icons'
  import { PIN_PATHS } from './icons'
  import { DELETED_CLOSE_MS, MINI_ADD_MS, miniControls, miniKey, type MiniControl } from './mini'

  interface Props {
    /** The card to show. */
    cardId: string
    /** The window the card is drawn in: its frames run the digits and its keys act on the card. */
    view?: Window
    /** Offer the always-on-top pin (the desktop's mini window). */
    pinnable?: boolean
    /** Announce the card's changes here (the desktop's mini window page). */
    announceChanges?: boolean
    /** Closes the mini window (the close button, Esc, a deleted card). */
    onclose: () => void
  }

  let {
    cardId,
    view = window,
    pinnable = false,
    announceChanges = false,
    onclose,
  }: Props = $props()

  const uid = $props.id()
  const nameId = `${uid}-name`
  const digitsId = `${uid}-digits`

  /** Animation frames of the window the card is drawn in. */
  function framesOf(target: Window): FrameScheduler<number> {
    return {
      request: (callback) => target.requestAnimationFrame(callback),
      cancel: (handle) => {
        target.cancelAnimationFrame(handle)
      },
    }
  }

  /** This window's own frame clock: the main window's stops while it is hidden. */
  const clock = createFrameClock(appClock, framesOf(untrack(() => view)))
  const keyPlatform = detectKeyPlatform()

  const card = $derived(cards.findCard(cardStore.list, cardId))
  const timeStyle = $derived(settingsStore.synced.timeStyle)
  const showOvertime = $derived(settingsStore.synced.showOvertime)
  const live = $derived(
    card === undefined
      ? false
      : card.kind === 'timer'
        ? timer.needsFrames(card.timer) && (card.timer.phase !== 'ringing' || showOvertime)
        : stopwatch.needsFrames(card.stopwatch),
  )
  const now = $derived(live ? clock.now : 0)
  const phase = $derived(
    card === undefined
      ? 'deleted'
      : card.kind === 'timer'
        ? card.timer.phase
        : card.stopwatch.phase,
  )

  /** What the digits read, in whole seconds for a timer (rounded as the card rounds them). */
  const text = $derived.by(() => {
    if (card === undefined) return ''
    if (card.kind === 'stopwatch')
      return formatElapsed(stopwatch.elapsed(card.stopwatch, now), timeStyle)
    const t = card.timer
    const remaining = Math.ceil(timer.remaining(t, now) / 1000) * 1000
    const overtime = Math.floor(timer.overtime(t, now) / 1000) * 1000
    return timerReadout(timerView(t, digits.EMPTY), digits.EMPTY, remaining, overtime, {
      style: timeStyle,
      showOvertime,
    })
  })
  const progress = $derived(card?.kind === 'timer' ? timer.progress(card.timer, now) : undefined)
  const dot = $derived(
    card?.kind === 'stopwatch' ? dotTurn(stopwatch.elapsed(card.stopwatch, now)) : undefined,
  )
  const controls = $derived(card === undefined ? [] : miniControls(card))
  const canStart = $derived(card?.kind !== 'timer' || card.timer.duration > 0)

  /** The name shown, kept once the card is deleted so the header does not go blank. */
  let name = $state(untrack(() => card?.name ?? ''))
  $effect.pre(() => {
    if (card !== undefined) name = card.name
  })
  /** The heading: the name, or "Mini window" for a card this window never knew. */
  const heading = $derived(name === '' ? m.card_mini_window() : name)

  /**
   * Keeps the second press of a double click on the header from the shell, which would maximize
   * the window (the mini window stays small; its capability does not allow that).
   */
  function keepSmall(header: HTMLElement): () => void {
    const onMousedown = (event: MouseEvent): void => {
      if (event.detail > 1) event.stopPropagation()
    }
    header.addEventListener('mousedown', onMousedown)
    return () => {
      header.removeEventListener('mousedown', onMousedown)
    }
  }

  // The digits move only while the card runs (or counts its overtime).
  $effect(() => {
    if (!live) return
    clock.setActive(true)
    return () => {
      clock.setActive(false)
    }
  })

  // A deleted card: say so, then close (an undo in time keeps the window). The desktop page says
  // it through its live region, which a screen reader already follows (text in a region inserted
  // with it is not reliably read); in Picture-in-Picture the app announces the deletion itself.
  $effect(() => {
    if (card !== undefined) return
    if (announceChanges) {
      untrack(() => {
        announce(m.mini_deleted())
      })
    }
    const timeout = setTimeout(onclose, DELETED_CLOSE_MS)
    return () => {
      clearTimeout(timeout)
    }
  })

  // In another window (Picture-in-Picture), gestures there unlock the app's audio, as the main
  // window's do, so a timer started here can ring.
  $effect(() => {
    if (view === window) return
    return unlockAudioOnGestures(platform.audio, view)
  })

  /** Inside a gesture that started a timer: unlock the app's audio when it plays in this realm. */
  function onStart(): void {
    if (view !== window) platform.audio.unlock()
  }

  // The desktop page announces the card's changes itself ("Tea paused, 4:53").
  let announced: cards.CardList | null = null
  $effect(() => {
    if (!announceChanges) return
    const list: cards.CardList = { cards: card === undefined ? [] : [card], selectedId: null }
    untrack(() => {
      const messages = announced === null ? [] : describeChanges(announced, list)
      announced = list
      if (messages.length > 0) announce(joinAnnouncements(messages))
    })
  })

  const BUTTONS: Readonly<
    Record<
      Exclude<MiniControl, 'add'>,
      { label: () => string; icon: IconName; variant: 'filled' | 'tonal' }
    >
  > = {
    start: { label: m.card_start, icon: 'play_arrow', variant: 'filled' },
    pause: { label: m.card_pause, icon: 'pause', variant: 'tonal' },
    resume: { label: m.card_resume, icon: 'play_arrow', variant: 'tonal' },
    dismiss: { label: m.card_dismiss, icon: 'check', variant: 'filled' },
    reset: { label: m.card_reset, icon: 'restart_alt', variant: 'tonal' },
    restart: { label: m.card_restart, icon: 'restart_alt', variant: 'tonal' },
    lap: { label: m.card_lap, icon: 'flag', variant: 'tonal' },
  }

  function run(control: MiniControl): void {
    const current = untrack(() => card)
    if (current === undefined) return
    const id = current.id
    if (current.kind === 'timer') {
      switch (control) {
        case 'start':
        case 'resume':
          startTimer(cardStore, id, digits.EMPTY, onStart)
          return
        case 'pause':
          cardStore.timer(id, timer.pause)
          return
        case 'dismiss':
          cardStore.timer(id, timer.dismiss)
          return
        case 'reset':
          cardStore.timer(id, timer.reset)
          return
        case 'restart':
          runTimer(cardStore, id, timer.restart, onStart)
          return
        case 'add':
          cardStore.timer(id, (s, at) => timer.addTime(s, MINI_ADD_MS, at))
          return
        case 'lap':
          return
      }
    }
    switch (control) {
      case 'start':
      case 'resume':
        cardStore.stopwatch(id, stopwatch.start)
        return
      case 'pause':
        cardStore.stopwatch(id, stopwatch.pause)
        return
      case 'lap':
        cardStore.stopwatch(id, stopwatch.lap)
        return
      case 'reset':
        cardStore.stopwatch(id, stopwatch.reset)
        return
      default:
        return
    }
  }

  /** The button key `key` stands for on `current` now, or null when it has none. */
  function keyControl(
    current: cards.Card,
    key: 'toggle' | 'start' | 'dismiss' | 'reset' | 'lap',
  ): MiniControl | null {
    const shown = miniControls(current)
    const first = (...wanted: MiniControl[]) => shown.find((c) => wanted.includes(c)) ?? null
    switch (key) {
      case 'toggle':
        return first('start', 'pause', 'resume', 'dismiss')
      case 'start':
        return first('start', 'resume', 'dismiss')
      case 'dismiss':
        return first('dismiss')
      case 'reset':
        return first('reset')
      case 'lap':
        return first('lap')
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing) return
    // A focused button keeps Space and Enter, which press it.
    const target = event.target as { closest?: (selector: string) => unknown } | null
    if ((event.key === ' ' || event.key === 'Enter') && target?.closest?.('button')) return
    const key = miniKey(settingsStore.bindings, event, keyPlatform)
    if (key === null) return
    event.preventDefault()
    if (event.repeat) return
    if (key === 'close') {
      onclose()
      return
    }
    const current = untrack(() => card)
    if (current === undefined) return
    if (key === 'toggle' && current.kind === 'timer') {
      // Space on a timer: the card's own rule (start, pause, resume or dismiss).
      if (current.timer.phase !== 'idle' || current.timer.duration > 0) {
        toggleTimer(cardStore, current.id, digits.EMPTY, onStart)
      }
      return
    }
    const control = keyControl(current, key)
    if (control !== null && (control !== 'start' || canStart)) run(control)
  }

  $effect(() => {
    const target = view
    target.addEventListener('keydown', onKeydown)
    return () => {
      target.removeEventListener('keydown', onKeydown)
    }
  })

  const onTop = $derived(settingsStore.desktop.miniAlwaysOnTop)

  function togglePin(): void {
    const next = !onTop
    settingsStore.updateDesktop({ miniAlwaysOnTop: next })
    void platform.windows.setAlwaysOnTop(next)
  }
</script>

<main class="mini" aria-labelledby={nameId} data-phase={phase}>
  <header class="header" data-tauri-drag-region {@attach keepSmall}>
    <span class="type" data-tauri-drag-region>
      <Icon name={card?.kind === 'stopwatch' ? 'timer' : 'hourglass_top'} />
    </span>
    <h1 class="name" id={nameId} title={heading} data-tauri-drag-region>{heading}</h1>
    {#if pinnable}
      <button
        type="button"
        class={['pin', { pressed: onTop }]}
        aria-pressed={onTop}
        aria-label={m.mini_pin()}
        title={m.mini_pin()}
        onclick={togglePin}
      >
        <svg
          viewBox={ICON_VIEW_BOX}
          width="1em"
          height="1em"
          fill="currentColor"
          focusable="false"
          aria-hidden="true"
        >
          <path d={onTop ? PIN_PATHS.on : PIN_PATHS.off} />
        </svg>
      </button>
    {/if}
    <IconButton icon="close" label={m.common_close()} onclick={onclose} />
  </header>

  {#if card === undefined}
    <p class="deleted" data-testid="mini-deleted" data-tauri-drag-region>{m.mini_deleted()}</p>
  {:else}
    <div class="body" data-tauri-drag-region>
      <span class="visually-hidden">{cardStatus(card)}</span>
      <div class="dial-area" data-tauri-drag-region>
        <div class="dial">
          <Ring {progress} {dot} pulse={phase === 'ringing'} />
          <div class="readout">
            <Digits id={digitsId} {text} />
            {#if phase === 'ringing'}
              <span class="note">{m.card_times_up()}</span>
            {/if}
          </div>
        </div>
      </div>
      <div class="controls">
        {#each controls as control (control)}
          {#if control === 'add'}
            <Button
              variant="tonal"
              label={quickAddLabel(MINI_ADD_MS)}
              class="add"
              onclick={() => {
                run('add')
              }}
            />
          {:else}
            {@const button = BUTTONS[control]}
            <Button
              variant={button.variant}
              label={button.label()}
              icon={button.icon}
              hideLabel
              disabled={control === 'start' && !canStart}
              onclick={() => {
                run(control)
              }}
            />
          {/if}
        {/each}
      </div>
    </div>
  {/if}
  <Announcer />
</main>

<style>
  .mini {
    container: mini / size;
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--card-surface, var(--md-sys-color-surface));
    color: var(--md-sys-color-on-surface);
    font-family: var(--font-ui);
    user-select: none;
    -webkit-user-select: none;
    /* Bigger digits for the ring than on a card: the window is all card. */
    --digit-ratio: 0.24;
    --chip-container: var(--card-tonal, var(--md-sys-color-surface-container-highest));
    --button-tonal-container: var(--card-tonal, var(--md-sys-color-surface-container-highest));
    --button-tonal-content: var(--md-sys-color-on-surface);
  }

  /* The header: a drag handle on desktop (the window has no title bar), with two small buttons. */
  .header {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    block-size: clamp(2.25rem, 18cqh, 2.75rem);
    padding-inline: var(--space-3) var(--space-1);
    --icon-button-size: clamp(2rem, 16cqh, 2.5rem);
    --icon-button-icon-size: clamp(1.125rem, 9cqh, 1.5rem);
    --icon-button-color: var(--md-sys-color-on-surface-variant);
    /*
     * A mouse-sized window: hit areas as big as the buttons (at least 32px, above WCAG 2.5.8's
     * 24px), so they never overlap; the 44px of the app's cards would not fit a 240×150 window.
     */
    --touch-target: var(--icon-button-size);
  }

  .type {
    display: inline-flex;
    flex: none;
    color: var(--md-sys-color-primary);
    font-size: clamp(1rem, 9cqh, 1.375rem);
  }

  .name {
    flex: 1;
    min-inline-size: 0;
    margin: 0;
    overflow: hidden;
    font-size: clamp(0.8125rem, 8cqh, 1.125rem);
    font-weight: 500;
    line-height: 1.3;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pin {
    position: relative;
    display: inline-grid;
    flex: none;
    place-items: center;
    inline-size: var(--icon-button-size);
    block-size: var(--icon-button-size);
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    background: transparent;
    color: var(--icon-button-color);
    font-size: var(--icon-button-icon-size);
    cursor: pointer;
  }

  .pin.pressed {
    color: var(--md-sys-color-primary);
  }

  .pin::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
  }

  .pin:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .pin:focus-visible::before,
  .pin:active::before {
    opacity: var(--state-focus, 0.1);
  }

  /* The ring and the buttons: side by side in a wide window, stacked in a tall one. */
  .body {
    container: mini-body / size;
    display: flex;
    flex: 1;
    gap: var(--space-2);
    min-block-size: 0;
    padding: 0 var(--space-3) var(--space-2);
  }

  .dial-area {
    container: dial / size;
    display: grid;
    flex: 1;
    min-inline-size: 0;
    min-block-size: 0;
    place-items: center;
  }

  .dial {
    --dial: calc(100cqmin - 0.25rem);
    position: relative;
    display: grid;
    place-items: center;
  }

  /* Digits at the ring's center; "Time's up" under them. */
  .readout {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: 1fr auto 1fr;
    justify-items: center;
  }

  .readout > :global(.digits) {
    grid-row: 2;
  }

  .note {
    grid-row: 3;
    align-self: start;
    color: var(--md-sys-color-primary);
    font-size: clamp(0.6875rem, calc(var(--dial) * 0.07), 1.25rem);
    font-weight: 500;
  }

  .controls {
    display: flex;
    flex: none;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    --button-height: clamp(2rem, 22cqh, 2.75rem);
    --button-font-size: clamp(0.75rem, 7cqh, 0.875rem);
    --button-icon-size: clamp(1.125rem, 11cqh, 1.5rem);
    --button-padding: 0.75em;
    --touch-target: var(--button-height);
  }

  .controls :global(.add) {
    font-variant-numeric: tabular-nums;
  }

  @container mini (aspect-ratio < 1.15) {
    .body {
      flex-direction: column;
    }

    .controls {
      flex-direction: row;
      --button-height: clamp(2rem, 12cqw, 2.75rem);
      --button-font-size: clamp(0.75rem, 4cqw, 0.875rem);
      --button-icon-size: clamp(1.125rem, 6cqw, 1.5rem);
    }
  }

  .deleted {
    display: grid;
    flex: 1;
    place-items: center;
    margin: 0;
    padding: var(--space-3);
    color: var(--md-sys-color-on-surface-variant);
    font-size: clamp(0.875rem, 8cqh, 1.125rem);
    text-align: center;
  }

  @media (forced-colors: active) {
    .mini {
      border: 1px solid CanvasText;
    }

    .pin::before {
      display: none;
    }

    .pin.pressed {
      color: Highlight;
    }
  }
</style>
