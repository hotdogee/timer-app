<!--
  @component
  A stopwatch card (spec › Card › Stopwatch). Idle: `0.00` and a full-width Start. Running: the
  elapsed time with centiseconds inside a ring whose dot turns once a minute; Pause, Lap, Reset.
  Paused: frozen; Resume, Reset. Laps list below the controls once the first lap is recorded.
  Times follow the time style setting (`1:05.43`, fixed `00:01:05.43`). Only a running stopwatch
  reads the frame clock.
-->
<script lang="ts">
  import { formatElapsed, stopwatch, type cards } from '../../core'
  import { m } from '../../i18n'
  import { cardStore } from '../../state/cards.svelte'
  import { settingsStore } from '../../state/settings.svelte'
  import { frameClock } from '../frame-clock.svelte'
  import { Button } from '../primitives'
  import Card from './Card.svelte'
  import Digits from './Digits.svelte'
  import { dotTurn } from './display'
  import LapList from './LapList.svelte'
  import Ring from './Ring.svelte'
  import type { CardShellProps } from './types'

  interface Props extends CardShellProps {
    card: cards.StopwatchCard
  }

  let { card, ...shell }: Props = $props()

  const timeStyle = $derived(settingsStore.synced.timeStyle)
  const s = $derived(card.stopwatch)
  const now = $derived(stopwatch.needsFrames(s) ? frameClock.now : 0)
  const elapsed = $derived(stopwatch.elapsed(s, now))
  const text = $derived(formatElapsed(elapsed, timeStyle))
  const dot = $derived(dotTurn(elapsed))
  const hasLaps = $derived(s.phase !== 'idle' && s.laps.length > 0)

  function start(): void {
    cardStore.stopwatch(card.id, stopwatch.start)
  }

  function pause(): void {
    cardStore.stopwatch(card.id, stopwatch.pause)
  }

  function lap(): void {
    cardStore.stopwatch(card.id, stopwatch.lap)
  }

  function reset(): void {
    cardStore.stopwatch(card.id, stopwatch.reset)
  }
</script>

<Card {card} phase={s.phase} {...shell}>
  {#snippet face(digitsId: string)}
    <div class="center">
      {#if s.phase === 'idle'}
        <Digits id={digitsId} {text} />
      {:else}
        <div class="dial">
          <Ring {dot} />
          <div class="readout"><Digits id={digitsId} {text} /></div>
        </div>
      {/if}
    </div>
  {/snippet}

  {#snippet controls()}
    {#if s.phase === 'idle'}
      <Button label={m.card_start()} icon="play_arrow" hideLabel fullWidth onclick={start} />
    {:else if s.phase === 'running'}
      <Button variant="tonal" label={m.card_pause()} icon="pause" hideLabel onclick={pause} />
      <Button variant="tonal" label={m.card_lap()} icon="flag" hideLabel onclick={lap} />
      <Button variant="tonal" label={m.card_reset()} icon="restart_alt" hideLabel onclick={reset} />
    {:else}
      <Button variant="tonal" label={m.card_resume()} icon="play_arrow" hideLabel onclick={start} />
      <Button variant="tonal" label={m.card_reset()} icon="restart_alt" hideLabel onclick={reset} />
    {/if}
  {/snippet}

  {#snippet after()}
    {#if hasLaps}
      <LapList state={s} {now} total={text} name={card.name} style={timeStyle} />
    {/if}
  {/snippet}
</Card>

<style>
  .center {
    display: grid;
    block-size: 100%;
    place-items: center;
  }

  .dial {
    position: relative;
    display: grid;
    place-items: center;
  }

  .readout {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }

  /*
   * Centered by their ink, as a running timer's (TimerCard): trimmed to the cap height and the
   * baseline, not the line box with the font's unequal ascent and descent.
   */
  .readout :global(.text) {
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
  }
</style>
