/**
 * Timer actions shared by every way of acting on a timer: keys, the command palette and the card's
 * buttons. Each applies typed digits the same way (spec › Digit entry: "apply typed digits, then
 * act") and reports starts, so audio unlocks and notification permission are asked for inside the
 * gesture whichever way the timer started.
 */
import { untrack } from 'svelte'

import {
  cards,
  digits,
  timer,
  type DigitBuffer,
  type EpochMs,
  type TimerPhase,
  type TimerState,
} from '../core'
import type { CardStore } from './cards.svelte'

/** The phase of timer `id` in the store now, without subscribing to the list. */
function timerPhase(store: CardStore, id: cards.CardId): TimerPhase | null {
  const card = cards.findCard(
    untrack(() => store.list),
    id,
  )
  return card?.kind === 'timer' ? card.timer.phase : null
}

/**
 * Runs a timer action on card `id` (`cardStore.timer`) and calls `onStart` when it started,
 * resumed or restarted the timer.
 */
export function runTimer(
  store: CardStore,
  id: cards.CardId,
  update: (t: TimerState, now: EpochMs) => TimerState,
  onStart?: (id: cards.CardId) => void,
): void {
  const before = timerPhase(store, id)
  store.timer(id, update)
  if (onStart === undefined || before === 'running') return
  if (timerPhase(store, id) === 'running') onStart(id)
}

/**
 * Start / pause (Space, the palette's Start/Pause): applies `typed` digits first (spec › Digit
 * entry), then starts an idle timer, pauses a running one, resumes a paused one or dismisses a
 * ringing one. Typed digits on a paused or ringing timer replace its duration, so it starts anew.
 */
export function toggleTimer(
  store: CardStore,
  id: cards.CardId,
  typed: DigitBuffer,
  onStart?: (id: cards.CardId) => void,
): void {
  runTimer(store, id, (t, now) => timer.toggle(cards.applyTyped(t, typed), now), onStart)
}

/**
 * Start (Enter, the card's Start and Resume buttons): with `typed` digits, sets that duration and
 * starts; without, starts or resumes, and dismisses a ringing timer.
 */
export function startTimer(
  store: CardStore,
  id: cards.CardId,
  typed: DigitBuffer,
  onStart?: (id: cards.CardId) => void,
): void {
  runTimer(
    store,
    id,
    (t, now) =>
      digits.isEmpty(typed) && t.phase === 'ringing'
        ? timer.dismiss(t)
        : timer.start(cards.applyTyped(t, typed), now),
    onStart,
  )
}
