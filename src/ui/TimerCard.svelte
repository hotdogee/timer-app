<!--
  Dev-harness timer card: shows one timer and reports button presses through callback props.
  It holds no state of its own; App owns the timer, the typed digits and the clock.
-->
<script lang="ts">
  import {
    digits,
    formatClockTime,
    formatCountdown,
    formatOvertime,
    timer,
    type DigitBuffer,
    type EpochMs,
    type Ms,
    type TimerState,
  } from '../core'

  interface Props {
    /** The timer to show. */
    state: TimerState
    /** The current time, from the shared frame clock. */
    now: EpochMs
    /** Digits typed for a new duration; shown instead of the time while not empty. */
    typed: DigitBuffer
    /** Start, Resume or Restart was pressed. */
    onstart: () => void
    /** Pause was pressed. */
    onpause: () => void
    /** Reset was pressed. */
    onreset: () => void
    /** Dismiss was pressed. */
    ondismiss: () => void
    /** A quick-add chip was pressed: add `delta` milliseconds. */
    onadd: (delta: Ms) => void
  }

  let { state, now, typed, onstart, onpause, onreset, ondismiss, onadd }: Props = $props()

  /** Quick-add chip values (spec › Timer). */
  const CHIPS: readonly Ms[] = [30_000, 60_000, 5 * 60_000]

  const editing = $derived(!digits.isEmpty(typed))
  const display = $derived.by(() => {
    if (editing) return digits.formatTyped(typed)
    if (state.phase === 'ringing') return formatOvertime(timer.overtime(state, now))
    return formatCountdown(timer.remaining(state, now))
  })
  const elapsedFraction = $derived(timer.progress(state, now))
  // Depends on the state only, so the label is formatted once per start, not every frame.
  const endsAt = $derived(timer.endTime(state))
  const endLabel = $derived(endsAt === null ? '' : `🔔 ${formatClockTime(endsAt)}`)
</script>

<section class="card">
  <h2>Timer</h2>
  <div class="display" class:editing role="timer" aria-live="off">{display}</div>
  <p class="status">{state.phase === 'ringing' ? "Time's up" : endLabel}</p>
  <progress max="1" value={elapsedFraction} aria-label="Elapsed"></progress>

  <div class="controls">
    {#if state.phase === 'idle'}
      <button onclick={onstart} disabled={!editing && state.duration === 0}>Start</button>
    {:else if state.phase === 'running'}
      <button onclick={onpause}>Pause</button>
      <button onclick={onreset}>Reset</button>
    {:else if state.phase === 'paused'}
      <button onclick={onstart}>{editing ? 'Start' : 'Resume'}</button>
      <button onclick={onreset}>Reset</button>
    {:else}
      <button onclick={ondismiss}>Dismiss</button>
      <button onclick={onstart}>{editing ? 'Start' : 'Restart'}</button>
    {/if}
  </div>

  {#if state.phase !== 'ringing'}
    <div class="chips" role="group" aria-label="Add time">
      {#each CHIPS as delta (delta)}
        <button
          onclick={() => {
            onadd(delta)
          }}>+{formatCountdown(delta)}</button
        >
      {/each}
    </div>
  {/if}
</section>
