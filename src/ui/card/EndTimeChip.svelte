<!--
  @component
  A running timer's end time under its digits: a bell and the wall-clock time it will ring
  ("🔔 2:47 PM"), in the locale's 12/24-hour style. Not interactive.

  ```svelte
  <EndTimeChip at={state.endsAt} />
  ```
-->
<script lang="ts">
  import { formatClockTime, type EpochMs } from '../../core'
  import { Icon } from '../primitives'

  interface Props {
    /** When the timer ends. */
    at: EpochMs
  }

  let { at }: Props = $props()

  const time = $derived(formatClockTime(at))
</script>

<span class="end-time" data-testid="end-time">
  <Icon name="notifications" />
  <span><span class="visually-hidden">Ends at&nbsp;</span>{time}</span>
</span>

<style>
  .end-time {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    padding-block: 0.3em;
    padding-inline: 0.6em 0.75em;
    border-radius: var(--radius-pill, 999px);
    background: var(--card-tonal, var(--md-sys-color-surface-container-highest));
    color: var(--md-sys-color-on-surface-variant);
    font-size: clamp(0.6875rem, calc(var(--dial, 12rem) * 0.052), 2rem);
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  @media (forced-colors: active) {
    .end-time {
      border: 1px solid CanvasText;
    }
  }
</style>
