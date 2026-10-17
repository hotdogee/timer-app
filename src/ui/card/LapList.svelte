<!--
  @component
  A stopwatch's laps below its controls (spec › Stopwatch): the lap in progress on top, then the
  recorded laps newest first, each with its number, its length and the total at that point. The
  card grows to show a few rows; beyond that the list scrolls (it is focusable for keyboard
  scrolling). Only the current row reads the frame clock; its total is the card's own readout.
-->
<script lang="ts">
  import { formatElapsed, stopwatch, type EpochMs, type StopwatchState } from '../../core'

  interface Props {
    state: StopwatchState
    /** The frame clock reading while the stopwatch runs (anything when it does not). */
    now: EpochMs
    /** The elapsed time as the card shows it, for the current row's total. */
    total: string
    /** The card's name, so each card's laps region has its own name. */
    name: string
  }

  let { state, now, total, name }: Props = $props()

  const rows = $derived(stopwatch.lapRows(state))
  const current = $derived(formatElapsed(stopwatch.currentLap(state, now)))
</script>

<!-- Scrollable region: focusable so keyboard users can scroll it. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="laps" role="region" aria-label="Laps, {name}" tabindex="0">
  <table>
    <thead>
      <tr>
        <th scope="col">Lap</th>
        <th scope="col">Lap time</th>
        <th scope="col">Total</th>
      </tr>
    </thead>
    <tbody>
      <tr class="current">
        <td>{rows.length + 1}</td>
        <td>{current}</td>
        <td>{total}</td>
      </tr>
      {#each rows as row (row.lap)}
        <tr>
          <td>{row.lap}</td>
          <td>{formatElapsed(row.duration)}</td>
          <td>{formatElapsed(row.split)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .laps {
    /* About 30% of the 3:2 area; the rest scrolls. */
    max-block-size: min(20cqw, 30vh);
    margin-block-start: calc(-1 * clamp(0.25rem, 1cqw, 1rem));
    padding-block: 0 clamp(0.5rem, 1.5cqw, 1.5rem);
    padding-inline: clamp(0.625rem, 1.85cqw, 1.75rem);
    overflow-y: auto;
    overscroll-behavior: contain;
    font-size: clamp(0.8125rem, 2.1cqw, 1.375rem);
    border-end-start-radius: inherit;
    border-end-end-radius: inherit;
  }

  .laps:focus-visible {
    outline-offset: -2px;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }

  th,
  td {
    padding-block: 0.35em;
    padding-inline: 0.5em;
    text-align: end;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    padding-inline-start: 0;
    text-align: start;
    color: var(--md-sys-color-on-surface-variant);
  }

  th:last-child,
  td:last-child {
    padding-inline-end: 0;
  }

  thead th {
    position: sticky;
    inset-block-start: 0;
    background: var(--card-surface, var(--md-sys-color-surface-container));
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.85em;
    font-weight: 500;
  }

  tbody tr {
    border-block-start: 1px solid var(--md-sys-color-outline-variant);
  }

  .current {
    color: var(--md-sys-color-primary);
  }

  @media (forced-colors: active) {
    tbody tr {
      border-color: CanvasText;
    }

    /* The lap in progress keeps its emphasis without color. */
    .current {
      font-weight: 700;
    }
  }
</style>
