<!--
  @component
  A timer card (spec › Card › Timer). Idle: the duration over a rule, quick-add chips and a
  full-width Start. Running: the ring fills clockwise around the time left, with the end time below
  it; Pause and Reset. Paused: frozen; Resume and Reset. Time's up: full ring (pulsing),
  overtime and "Time's up"; Dismiss and Restart. Typed digits (`typed`, only on the selected card)
  show in the primary color; Start and the chips apply them first, as the keyboard does, and Reset
  discards them.

  Only a running or ringing timer reads the frame clock, so idle and paused cards cost nothing per
  frame; display strings are derived from whole seconds and change once a second.
-->
<script lang="ts">
  import { cards, digits, formatCountdown, timer, type DigitBuffer, type Ms } from '../../core'
  import { cardStore } from '../../state/cards.svelte'
  import { runTimer, startTimer } from '../../state/timer-actions'
  import { frameClock } from '../frame-clock.svelte'
  import { Button, Chip } from '../primitives'
  import Card from './Card.svelte'
  import Digits from './Digits.svelte'
  import { QUICK_ADD, overtimeText, quickAddLabel, timerView } from './display'
  import EndTimeChip from './EndTimeChip.svelte'
  import Ring from './Ring.svelte'
  import type { CardShellProps } from './types'

  interface Props extends CardShellProps {
    card: cards.TimerCard
    /** Digits typed for this card's next duration (the selected card only). */
    typed?: DigitBuffer
    /** The card used or discarded the typed digits: called with the empty buffer. */
    ontyped?: ((buffer: DigitBuffer) => void) | undefined
    /**
     * Runs synchronously inside a Start, Resume or Restart click, before the timer starts: the app
     * unlocks audio and asks for notification permission there, while the gesture counts.
     */
    onstart?: (() => void) | undefined
  }

  let { card, typed = digits.EMPTY, ontyped, onstart, ...shell }: Props = $props()

  const t = $derived(card.timer)
  const view = $derived(timerView(t, typed))
  const now = $derived(timer.needsFrames(t) ? frameClock.now : 0)
  const remainingSeconds = $derived(Math.ceil(timer.remaining(t, now) / 1000))
  const overtimeSeconds = $derived(Math.floor(timer.overtime(t, now) / 1000))
  const text = $derived.by(() => {
    if (view === 'typing') return digits.formatTyped(typed)
    if (view === 'ringing') return overtimeText(overtimeSeconds * 1000)
    return formatCountdown(remainingSeconds * 1000)
  })
  const progress = $derived(timer.progress(t, now))
  const endsAt = $derived(timer.endTime(t))

  /** Hands back the typed digits for one action and clears them. */
  function takeTyped(): DigitBuffer {
    const buffer = typed
    if (!digits.isEmpty(buffer)) ontyped?.(digits.EMPTY)
    return buffer
  }

  /** Start and Resume: the same rule as Enter (`startTimer`), typed digits first. */
  function start(): void {
    startTimer(cardStore, card.id, takeTyped(), onstart)
  }

  /** A running timer has no typed digits (it ignores them), so Pause just pauses. */
  function pause(): void {
    cardStore.timer(card.id, timer.pause)
  }

  /** Reset discards typed digits instead of applying them. */
  function reset(): void {
    if (!digits.isEmpty(typed)) ontyped?.(digits.EMPTY)
    cardStore.timer(card.id, timer.reset)
  }

  /** Dismiss shows only while ringing without typed digits (typing shows Start instead). */
  function dismiss(): void {
    cardStore.timer(card.id, timer.dismiss)
  }

  function restart(): void {
    runTimer(cardStore, card.id, timer.restart, onstart)
  }

  function add(ms: Ms): void {
    const buffer = takeTyped()
    cardStore.timer(card.id, (s, at) => timer.addTime(cards.applyTyped(s, buffer), ms, at))
  }

  const canStart = $derived(view === 'typing' || t.duration > 0)
</script>

{#snippet chips(inert: boolean)}
  <div class="chips" class:spacer={inert} {inert}>
    {#each QUICK_ADD as ms (ms)}
      <Chip
        label={quickAddLabel(ms)}
        onclick={() => {
          add(ms)
        }}
      />
    {/each}
  </div>
{/snippet}

<Card {card} phase={t.phase} {...shell}>
  {#snippet face(digitsId: string)}
    {#if view === 'idle' || view === 'typing'}
      <div class="setter">
        <Digits id={digitsId} {text} tone={view === 'typing' ? 'typing' : 'default'} underline />
        {@render chips(false)}
      </div>
    {:else}
      <div class="dial-area">
        <div class="dial">
          <Ring {progress} pulse={view === 'ringing'} />
          <div class="readout">
            <Digits id={digitsId} {text} />
            {#if endsAt !== null}
              <span class="note"><EndTimeChip at={endsAt} /></span>
            {:else if view === 'ringing'}
              <span class="note times-up">Time's up</span>
            {/if}
          </div>
        </div>
      </div>
      <!-- Chips stay while running or paused; ringing keeps their room so the ring holds still. -->
      {@render chips(view === 'ringing')}
    {/if}
  {/snippet}

  {#snippet controls()}
    {#if view === 'idle' || view === 'typing'}
      <Button
        label="Start"
        icon="play_arrow"
        hideLabel
        fullWidth
        disabled={!canStart}
        onclick={start}
      />
    {:else if view === 'running'}
      <Button variant="tonal" label="Pause" icon="pause" hideLabel onclick={pause} />
      <Button variant="tonal" label="Reset" icon="restart_alt" hideLabel onclick={reset} />
    {:else if view === 'paused'}
      <Button variant="tonal" label="Resume" icon="play_arrow" hideLabel onclick={start} />
      <Button variant="tonal" label="Reset" icon="restart_alt" hideLabel onclick={reset} />
    {:else}
      <Button label="Dismiss" icon="check" hideLabel onclick={dismiss} />
      <Button variant="tonal" label="Restart" icon="restart_alt" hideLabel onclick={restart} />
    {/if}
  {/snippet}
</Card>

<style>
  /* Idle: the duration, its rule and the chips, centered as one group. */
  .setter {
    display: flex;
    block-size: 100%;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--chip-font) * 1.8);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: calc(var(--chip-font) * 0.5);
    --chip-font-size: var(--chip-font);
  }

  .spacer {
    visibility: hidden;
  }

  /* Running, paused, ringing: the ring takes the room above the chips row. */
  .dial-area {
    display: grid;
    block-size: calc(100% - var(--below));
    place-items: center;
  }

  .dial {
    position: relative;
    display: grid;
    place-items: center;
  }

  /* The chips sit in the middle of their band, as far from the ring as from the buttons. */
  .dial-area + .chips {
    block-size: var(--below);
    align-content: center;
    align-items: center;
  }

  /* Digits sit exactly at the ring's center; the note hangs below them. */
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
    margin-block-start: calc(var(--dial) * 0.03);
  }

  /* Steady, so the small text keeps its contrast; the ring pulses instead (Ring). */
  .times-up {
    color: var(--md-sys-color-primary);
    font-size: clamp(0.75rem, calc(var(--dial) * 0.06), 2.25rem);
    font-weight: 500;
  }

  /*
   * A short face (see Card): the chips stack beside the ring instead of under it, a touch target
   * (44px) apart from center to center, so each chip's hit area (Chip's ::after) stays clear of
   * the next.
   */
  @container face (max-height: 12.5rem) {
    .dial-area + .chips {
      position: absolute;
      inset-block: 0;
      inset-inline-end: 0;
      block-size: auto;
      flex-direction: column;
      flex-wrap: nowrap;
      justify-content: center;
      gap: max(
        calc(var(--chip-font) * 0.5),
        calc(var(--touch-target, 44px) - var(--chip-font) * 2.4)
      );
    }
  }

  /*
   * Fewer chips where three 44px targets would not fit the face and its margins (a phone card
   * narrower than about 390px): +0:30 goes first, then +5:00, so no target reaches the header or
   * the buttons.
   */
  @container face (max-height: 7.75rem) {
    .dial-area + .chips > :global(.chip:first-child) {
      display: none;
    }
  }

  @container face (max-height: 5rem) {
    .dial-area + .chips > :global(.chip:last-child) {
      display: none;
    }
  }

  @media (forced-colors: active) {
    .times-up {
      color: CanvasText;
    }
  }
</style>
