<!--
  @component
  A timer card (spec › Card › Timer). Idle: the duration over a rule, quick-add chips and a
  full-width Start; hovering the duration shows ▲ and ▼ steppers over and under each of its fields
  (always shown on touch screens), which add or take away an hour, a minute or a second, again and
  again while held (a ▼ with less than its unit left is disabled). Running: the ring fills
  clockwise around the time left and the end time, centered as one group; Pause and Reset.
  Paused: frozen, "Paused" under the time; Resume and Reset. Time's up: full ring (pulsing),
  overtime and "Time's up" under it; Dismiss and Restart. Typed digits (`typed`, only on the
  selected card) show in the primary color; Start and the chips apply them first, as the keyboard
  does, and Reset discards them.

  Settings: the time style (compact or fixed), the overtime counter (off: a ringing timer stays at
  `0:00`) and the three quick-add amounts. An idle timer shows the fixed form (`00:05:00`)
  whatever the time style, so a stepper stands over the hours too; typed digits still show as
  typed, and a running, paused or ringing timer follows the setting.

  The steppers are for the pointer: out of the tab order (the keyboard types digits instead), and a
  press leaves focus where it was, so Space and Enter go on starting the timer rather than pressing
  the stepper again. Hidden, they ignore the pointer, so a click near the time never changes it
  unseen.

  Only a running timer, or a ringing one that counts its overtime, reads the frame clock, so other
  cards cost nothing per frame; display strings are derived from whole seconds and change once a
  second. The settings are read in their own deriveds, outside that per-frame path.
-->
<script lang="ts">
  import { cards, digits, timer, type DigitBuffer, type Ms, type TimeStyle } from '../../core'
  import { m } from '../../i18n'
  import { cardStore } from '../../state/cards.svelte'
  import { settingsStore } from '../../state/settings.svelte'
  import { runTimer, startTimer } from '../../state/timer-actions'
  import { frameClock } from '../frame-clock.svelte'
  import { Button, Chip, Icon } from '../primitives'
  import Card from './Card.svelte'
  import Digits from './Digits.svelte'
  import { quickAddLabel, timerReadout, timerView } from './display'
  import EndTimeChip from './EndTimeChip.svelte'
  import { holdRepeat } from './hold-repeat'
  import Ring from './Ring.svelte'
  import {
    canStep,
    durationFields,
    stepDelta,
    stepLabel,
    type DurationUnit,
    type StepDirection,
  } from './stepper'
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

  const timeStyle = $derived(settingsStore.synced.timeStyle)
  const showOvertime = $derived(settingsStore.synced.showOvertime)
  const quickAdd = $derived(settingsStore.synced.quickAdd)

  const t = $derived(card.timer)
  const view = $derived(timerView(t, typed))
  /** Idle is always fixed, so the hours have their field and steppers (see above). */
  const style: TimeStyle = $derived(view === 'idle' ? 'fixed' : timeStyle)
  /** Whether the display changes over time: running, or ringing with the overtime counter. */
  const live = $derived(timer.needsFrames(t) && (t.phase !== 'ringing' || showOvertime))
  const now = $derived(live ? frameClock.now : 0)
  const remainingSeconds = $derived(Math.ceil(timer.remaining(t, now) / 1000))
  const overtimeSeconds = $derived(Math.floor(timer.overtime(t, now) / 1000))
  const text = $derived(
    timerReadout(view, typed, remainingSeconds * 1000, overtimeSeconds * 1000, {
      style,
      showOvertime,
    }),
  )
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

  /** The fields the steppers stand over: an idle timer's only (not typed digits). */
  const fields = $derived(view === 'idle' ? durationFields(text) : [])

  /**
   * A stepper: one unit of a field up or down; the engine carries. A ▼ that would clamp to zero is
   * disabled, and checked again here against the state it applies to (a hold racing a re-render).
   */
  function step(unit: DurationUnit, direction: StepDirection): void {
    cardStore.timer(card.id, (s, at) =>
      canStep(s.duration, unit, direction) ? timer.addTime(s, stepDelta(unit, direction), at) : s,
    )
  }

  /** A stepper press leaves focus where it was (see above); its click still selects the card. */
  function keepFocus(event: MouseEvent): void {
    event.preventDefault()
  }
</script>

{#snippet chips(inert: boolean)}
  <div class="chips" class:spacer={inert} {inert}>
    <!-- By position: two chips may add the same amount. -->
    {#each quickAdd as ms, index (index)}
      <Chip
        label={quickAddLabel(ms)}
        onclick={() => {
          add(ms)
        }}
      />
    {/each}
  </div>
{/snippet}

<!--
  A row of steppers: a cell per field, as wide as the field's text in the digits' font (an invisible
  copy of it), with the button over it, and the colons' room between them, so each button stands
  over its field. Keyed by unit, so a held button stays when an hours field comes or goes.
-->
{#snippet steps(direction: StepDirection)}
  {#if fields.length > 0}
    <span class={['steps', direction]}>
      {#each fields as field, index (field.unit)}
        {#if index > 0}
          <span class="ghost" aria-hidden="true">:</span>
        {/if}
        <span class="cell">
          <span class="ghost">{field.text}</span>
          <button
            type="button"
            class="step"
            tabindex="-1"
            disabled={!canStep(t.duration, field.unit, direction)}
            aria-label={stepLabel(field.unit, direction)}
            title={stepLabel(field.unit, direction)}
            onmousedown={keepFocus}
            {@attach holdRepeat(() => {
              step(field.unit, direction)
            })}
          >
            <Icon name={direction === 'up' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} />
          </button>
        </span>
      {/each}
    </span>
  {/if}
{/snippet}

<Card {card} phase={t.phase} {...shell}>
  {#snippet face(digitsId: string)}
    {#if view === 'idle' || view === 'typing'}
      <div class="setter">
        <div class="time">
          <Digits id={digitsId} {text} tone={view === 'typing' ? 'typing' : 'default'} underline>
            {#snippet above()}
              {@render steps('up')}
            {/snippet}
            {#snippet below()}
              {@render steps('down')}
            {/snippet}
          </Digits>
        </div>
        {@render chips(false)}
      </div>
    {:else}
      <div class="dial-area">
        <div class="dial">
          <Ring {progress} pulse={view === 'ringing'} />
          <div class="readout">
            <Digits id={digitsId} {text} />
            <!-- Always rendered (see .note), so the digits hold still as the note changes. -->
            <span class={['note', { 'times-up': view === 'ringing', paused: view === 'paused' }]}>
              {#if endsAt !== null}
                <EndTimeChip at={endsAt} />
              {:else if view === 'ringing'}
                {m.card_times_up()}
              {:else}
                {m.card_paused()}
              {/if}
            </span>
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
        label={m.card_start()}
        icon="play_arrow"
        hideLabel
        fullWidth
        disabled={!canStart}
        onclick={start}
      />
    {:else if view === 'running'}
      <Button variant="tonal" label={m.card_pause()} icon="pause" hideLabel onclick={pause} />
      <Button variant="tonal" label={m.card_reset()} icon="restart_alt" hideLabel onclick={reset} />
    {:else if view === 'paused'}
      <Button variant="tonal" label={m.card_resume()} icon="play_arrow" hideLabel onclick={start} />
      <Button variant="tonal" label={m.card_reset()} icon="restart_alt" hideLabel onclick={reset} />
    {:else}
      <Button label={m.card_dismiss()} icon="check" hideLabel onclick={dismiss} />
      <Button
        variant="tonal"
        label={m.card_restart()}
        icon="restart_alt"
        hideLabel
        onclick={restart}
      />
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
    gap: var(--setter-gap);
    /* Between the rule and the chips: the room for the ▼ steppers. */
    --setter-gap: calc(var(--chip-font) * 1.8);
    /*
     * No ring here: the fixed form (00:05:00) fits the face's width, so the digits keep the
     * running face's size (no jump on Start) and the size setting its whole range.
     */
    --digits-fit: 100cqw;
  }

  /*
   * The steppers' rows hang over and under the digits (and the rule), out of the layout, so the
   * setter keeps its size and the digits stay put when the timer starts. A row is half a digit
   * tall, at least 1.75rem, but never taller than the gap to the chips, so big digits (fullscreen)
   * keep the ▼ row clear of them. Rows are positioned like the chips (whose hit areas, later in
   * the page, win where a row meets them) and under the header's buttons (z-index 1), which a row
   * may reach on a short face.
   */
  .steps {
    position: absolute;
    inset-inline: 0;
    display: flex;
    justify-content: center;
    block-size: min(max(0.5em, 1.75rem), var(--setter-gap));
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .up {
    inset-block-end: 100%;
  }

  .down {
    inset-block-start: 100%;
  }

  .time:hover .steps,
  .time:focus-within .steps {
    opacity: 1;
    pointer-events: auto;
  }

  /* Touch screens have no hover, and often no keyboard to type digits with. */
  @media (hover: none) {
    .steps {
      opacity: 1;
      pointer-events: auto;
    }
  }

  .cell {
    position: relative;
  }

  /* A field's text (or a colon) in the digits' font, only for its width. */
  .ghost {
    display: block;
    block-size: 0;
    overflow: hidden;
    white-space: nowrap;
    visibility: hidden;
  }

  .step {
    position: absolute;
    inset: 0;
    /* Flex, not grid: an icon wider than a one-digit cell overhangs both sides, centered. */
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-small, 8px);
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    /* Half a digit, from 1rem (legible on the narrowest card) to 1.5rem; it may overhang a cell. */
    font-size: clamp(1rem, 0.5em, 1.5rem);
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .step::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .step:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .step:focus-visible::before {
    opacity: var(--state-focus, 0.1);
  }

  .step:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .step:disabled {
    color: color-mix(in srgb, var(--md-sys-color-on-surface) 38%, transparent);
    cursor: default;
  }

  .step:disabled::before {
    opacity: 0;
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

  /*
   * The chips sit at the foot of their band (--below: a chip and three face gaps, Card), two face
   * gaps under a ring that takes the band's full height, and one gap over the face's edge, which
   * the face's margin makes two from the buttons: as far from the ring as from the buttons.
   */
  .dial-area + .chips {
    block-size: var(--below);
    align-content: end;
    align-items: end;
    padding-block-end: var(--face-gap);
  }

  /* The digits and the note under them, centered in the ring as one group. */
  .readout {
    position: absolute;
    inset: 0;
    display: grid;
    align-content: center;
    justify-items: center;
  }

  /*
   * Centered by their ink: the line box carries the font's unequal ascent and descent, so a
   * centered line box puts the digits a little off center (more with some system fonts); trimmed
   * to the cap height and the baseline, the glyphs themselves are centered. Browsers without
   * text-box-trim keep the line box. Not on the idle face's digits: its steppers and rule are laid
   * out against the line box.
   */
  .readout :global(.text) {
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
  }

  /*
   * At least the end-time chip's height (its font size × 1.8, EndTimeChip: keep the two in step),
   * so the digits stay put when the note changes between the end time, "Paused" and "Time's up".
   */
  .note {
    display: grid;
    place-items: center;
    min-block-size: calc(1.8 * clamp(0.6875rem, var(--dial) * 0.052, 2rem));
    margin-block-start: calc(var(--dial) * 0.03);
  }

  .times-up,
  .paused {
    font-size: clamp(0.75rem, calc(var(--dial) * 0.06), 2.25rem);
    font-weight: 500;
    line-height: 1.2;
  }

  /* Steady, so the small text keeps its contrast; the ring pulses instead (Ring). */
  .times-up {
    color: var(--md-sys-color-primary);
  }

  .paused {
    color: var(--md-sys-color-on-surface-variant);
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
      padding-block-end: 0;
      flex-direction: column;
      flex-wrap: nowrap;
      align-items: center;
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

  @media (prefers-reduced-motion: reduce) {
    .steps,
    .step::before {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .times-up,
    .paused {
      color: CanvasText;
    }

    .step {
      border-color: CanvasText;
    }

    .step::before {
      display: none;
    }

    .step:disabled {
      border-color: GrayText;
      color: GrayText;
    }
  }
</style>
