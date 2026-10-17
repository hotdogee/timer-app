<!--
  Dev-harness stopwatch card: shows one stopwatch with its laps and reports button presses through
  callback props. It holds no state of its own; App owns the stopwatch and the clock.
-->
<script lang="ts">
  import { formatElapsed, stopwatch, type EpochMs, type StopwatchState } from '../core'

  interface Props {
    /** The stopwatch to show. */
    state: StopwatchState
    /** The current time, from the shared frame clock. */
    now: EpochMs
    /** Start or Resume was pressed. */
    onstart: () => void
    /** Pause was pressed. */
    onpause: () => void
    /** Reset was pressed. */
    onreset: () => void
    /** Lap was pressed. */
    onlap: () => void
  }

  let { state, now, onstart, onpause, onreset, onlap }: Props = $props()

  /** One recorded lap as displayed. */
  interface LapRow {
    readonly number: number
    readonly lap: string
    readonly split: string
  }

  const display = $derived(formatElapsed(stopwatch.elapsed(state, now)))
  const current = $derived(formatElapsed(stopwatch.currentLap(state, now)))
  // Recorded laps, newest first. Depends on the state only, so it is not rebuilt every frame.
  const recorded = $derived.by((): readonly LapRow[] => {
    if (state.phase === 'idle') return []
    const durations = stopwatch.lapDurations(state)
    return state.laps
      .map((split, i) => ({
        number: i + 1,
        lap: formatElapsed(durations[i] ?? 0),
        split: formatElapsed(split),
      }))
      .reverse()
  })
</script>

<section class="card">
  <h2>Stopwatch</h2>
  <div class="display" role="timer" aria-live="off">{display}</div>

  <div class="controls">
    {#if state.phase === 'idle'}
      <button onclick={onstart}>Start</button>
    {:else if state.phase === 'running'}
      <button onclick={onpause}>Pause</button>
      <button onclick={onlap}>Lap</button>
      <button onclick={onreset}>Reset</button>
    {:else}
      <button onclick={onstart}>Resume</button>
      <button onclick={onreset}>Reset</button>
    {/if}
  </div>

  {#if recorded.length > 0}
    <table>
      <thead>
        <tr><th scope="col">Lap</th><th scope="col">Lap time</th><th scope="col">Split</th></tr>
      </thead>
      <tbody>
        <tr class="current">
          <td>{recorded.length + 1}</td><td>{current}</td><td>{display}</td>
        </tr>
        {#each recorded as row (row.number)}
          <tr><td>{row.number}</td><td>{row.lap}</td><td>{row.split}</td></tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
