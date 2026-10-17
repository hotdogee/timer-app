<!--
  Milestone 1 dev harness: one timer and one stopwatch driven by the core engine, with keyboard
  digit entry. The designed Material 3 card replaces it in milestone 2.
-->
<script lang="ts">
  import {
    digits,
    stopwatch,
    timer,
    type EpochMs,
    type Ms,
    type StopwatchState,
    type TimerState,
  } from './core'
  import { frameClock } from './ui/frame-clock.svelte'
  import StopwatchCard from './ui/StopwatchCard.svelte'
  import TimerCard from './ui/TimerCard.svelte'

  /** The timer's first duration, as in the spec's idle example (`5:00`). */
  const INITIAL_DURATION: Ms = 5 * 60_000

  /** Exactly one ASCII digit: what `KeyboardEvent.key` reports for the digit row and the numpad. */
  const DIGIT_KEY = /^[0-9]$/

  // Engine states are immutable and replaced whole, so `$state.raw` is enough, and an action that
  // returns the same object changes nothing.
  let timerState = $state.raw(timer.createTimer(INITIAL_DURATION))
  let stopwatchState = $state.raw(stopwatch.createStopwatch())
  // Digits typed for the timer's next duration. Every timer action applies them first; Esc and
  // Reset discard them. Typing is ignored while the timer runs, so they are empty while it runs.
  let typed = $state(digits.EMPTY)

  // One frame loop for the page, running only while a display changes over time.
  const animating = $derived(timer.needsFrames(timerState) || stopwatch.needsFrames(stopwatchState))
  $effect(() => {
    if (!animating) return
    frameClock.setActive(true)
    return () => {
      frameClock.setActive(false)
    }
  })

  // Every frame: a running timer whose end has come starts ringing, dated from its real end.
  $effect(() => {
    const settled = timer.settle(timerState, frameClock.now)
    if (settled !== timerState) timerState = settled
  })

  /** Reads the clock for a user action, so the transition and every view use the same `now`. */
  function actionTime(): EpochMs {
    frameClock.bump()
    return frameClock.now
  }

  /**
   * Runs a timer action at the current time. Typed digits are applied first as the new duration
   * (which resets a paused or ringing timer; spec › Digit entry), so the action uses what is shown.
   */
  function timerAction(action: (s: TimerState, now: EpochMs) => TimerState): void {
    const now = actionTime()
    const s = digits.isEmpty(typed)
      ? timerState
      : timer.setDuration(timerState, digits.toDurationMs(typed))
    typed = digits.EMPTY
    timerState = action(s, now)
  }

  function startTimer(): void {
    timerAction(timer.start)
  }

  function pauseTimer(): void {
    timerAction(timer.pause)
  }

  function toggleTimer(): void {
    timerAction(timer.toggle)
  }

  function dismissTimer(): void {
    timerAction(timer.dismiss)
  }

  function addTime(delta: Ms): void {
    timerAction((s, now) => timer.addTime(s, delta, now))
  }

  /** Enter: starts; with nothing typed, dismisses a ringing timer instead (spec › Digit entry). */
  function enter(): void {
    timerAction((s, now) => (s.phase === 'ringing' ? timer.dismiss(s) : timer.start(s, now)))
  }

  /** Reset discards typed digits instead of applying them: it returns to the configured duration. */
  function resetTimer(): void {
    typed = digits.EMPTY
    timerState = timer.reset(timerState)
  }

  function stopwatchAction(action: (s: StopwatchState, now: EpochMs) => StopwatchState): void {
    stopwatchState = action(stopwatchState, actionTime())
  }

  function startStopwatch(): void {
    stopwatchAction(stopwatch.start)
  }

  function pauseStopwatch(): void {
    stopwatchAction(stopwatch.pause)
  }

  function lap(): void {
    stopwatchAction(stopwatch.lap)
  }

  function resetStopwatch(): void {
    stopwatchState = stopwatch.reset(stopwatchState)
  }

  /** Single-press shortcuts; a held key does not repeat them. */
  function shortcut(key: string): (() => void) | undefined {
    switch (key) {
      case 'Enter':
        return enter
      case 'Escape':
        return () => {
          typed = digits.EMPTY
        }
      case ' ':
        return toggleTimer
      case 'r':
      case 'R':
        return resetTimer
      case 'l':
      case 'L':
        return lap
      default:
        return undefined
    }
  }

  /** Whether `target` is a text field, which owns every key typed into it. */
  function isTextEntry(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.matches('input, textarea, select'))
    )
  }

  /** Whether `target` is a control that already acts on Space and Enter, such as a button. */
  function isActivatable(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('button, a[href], summary') !== null
  }

  function onKeydown(event: KeyboardEvent): void {
    // Keys with Ctrl, Alt or Meta are browser and OS shortcuts (Ctrl+R reloads). Shift is allowed:
    // `key` already includes it, and some layouts (AZERTY) need it to type digits.
    if (event.ctrlKey || event.altKey || event.metaKey) return
    if (event.defaultPrevented || event.isComposing || isTextEntry(event.target)) return
    const { key } = event
    // A focused button acts on Space and Enter itself; acting here as well would act twice.
    if ((key === ' ' || key === 'Enter') && isActivatable(event.target)) return

    if (DIGIT_KEY.test(key)) {
      // Digits edit the timer only while it is not running (spec › Digit entry).
      if (timerState.phase === 'running') return
      typed = digits.pushDigit(typed, key)
    } else if (key === 'Backspace') {
      typed = digits.popDigit(typed)
    } else {
      const action = shortcut(key)
      if (action === undefined) return
      if (!event.repeat) action()
    }
    event.preventDefault()
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main>
  <h1>Timer App <small>dev harness</small></h1>

  <div class="cards">
    <TimerCard
      state={timerState}
      now={frameClock.now}
      {typed}
      onstart={startTimer}
      onpause={pauseTimer}
      onreset={resetTimer}
      ondismiss={dismissTimer}
      onadd={addTime}
    />
    <StopwatchCard
      state={stopwatchState}
      now={frameClock.now}
      onstart={startStopwatch}
      onpause={pauseStopwatch}
      onreset={resetStopwatch}
      onlap={lap}
    />
  </div>

  <ul class="keys" aria-label="Keyboard shortcuts">
    <li><kbd>0</kbd>–<kbd>9</kbd> type a timer duration</li>
    <li><kbd>Backspace</kbd> delete a digit</li>
    <li><kbd>Esc</kbd> cancel typing</li>
    <li><kbd>Enter</kbd> start or dismiss</li>
    <li><kbd>Space</kbd> start or pause the timer</li>
    <li><kbd>R</kbd> reset the timer</li>
    <li><kbd>L</kbd> lap the stopwatch</li>
  </ul>
</main>
