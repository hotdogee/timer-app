<!--
  @component
  A running timer's end time under its digits: a bell and the wall-clock time it will ring
  ("🔔 2:47 PM"), in the app locale's 12/24-hour style (the browser's own variant of it, such as
  en-GB), unless the 12/24-hour setting says otherwise. Not interactive.

  ```svelte
  <EndTimeChip at={state.endsAt} />
  ```
-->
<script lang="ts">
  import { formatClockTime, type EpochMs } from '../../core'
  import { browserLanguages, localeState, m } from '../../i18n'
  import { settingsStore } from '../../state/settings.svelte'
  import { Icon } from '../primitives'
  import { clockHourCycle, clockLocale } from './display'

  interface Props {
    /** When the timer ends. */
    at: EpochMs
  }

  let { at }: Props = $props()

  const locale = $derived(clockLocale(localeState.current, browserLanguages()))
  const hourCycle = $derived(clockHourCycle(settingsStore.synced.hourCycle))
  const time = $derived(formatClockTime(at, { locale, hourCycle }))
</script>

<span class="end-time" data-testid="end-time">
  <Icon name="notifications" />
  <span class="time"><span class="visually-hidden">{m.card_ends_at()}&nbsp;</span>{time}</span>
</span>

<style>
  .end-time {
    display: inline-flex;
    align-items: center;
    gap: 0.35em;
    /*
     * A 1.2 line and 0.3em over and under it, as a fixed height so the trimmed text cannot shrink
     * the pill. TimerCard's .note is as tall: keep the two in step.
     */
    block-size: 1.8em;
    padding-block: 0;
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

  /* Trimmed to the cap height and baseline: centered by its ink, not the font's uneven line box. */
  .time {
    text-box-trim: trim-both;
    text-box-edge: cap alphabetic;
  }

  @media (forced-colors: active) {
    .end-time {
      border: 1px solid CanvasText;
    }
  }
</style>
