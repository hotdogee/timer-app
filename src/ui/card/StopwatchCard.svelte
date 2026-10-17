<!--
  @component
  A stopwatch card (spec › Card › Stopwatch). Idle: `0.00` and a full-width Start. Running: the
  elapsed time with centiseconds inside a ring whose dot turns once a minute; Pause, Lap, Reset.
  Paused: frozen; Resume, Reset. Laps list below the controls once the first lap is recorded.
  Only a running stopwatch reads the frame clock.
-->
<script lang="ts">
  import { formatElapsed, stopwatch, type cards } from '../../core'
  import { cardStore } from '../../state/cards.svelte'
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

  const s = $derived(card.stopwatch)
  const now = $derived(stopwatch.needsFrames(s) ? frameClock.now : 0)
  const elapsed = $derived(stopwatch.elapsed(s, now))
  const text = $derived(formatElapsed(elapsed))
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
      <Button label="Start" icon="play_arrow" hideLabel fullWidth onclick={start} />
    {:else if s.phase === 'running'}
      <Button variant="tonal" label="Pause" icon="pause" hideLabel onclick={pause} />
      <Button variant="tonal" label="Lap" icon="flag" hideLabel onclick={lap} />
      <Button variant="tonal" label="Reset" icon="restart_alt" hideLabel onclick={reset} />
    {:else}
      <Button variant="tonal" label="Resume" icon="play_arrow" hideLabel onclick={start} />
      <Button variant="tonal" label="Reset" icon="restart_alt" hideLabel onclick={reset} />
    {/if}
  {/snippet}

  {#snippet after()}
    {#if hasLaps}
      <LapList state={s} {now} total={text} name={card.name} />
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
</style>
