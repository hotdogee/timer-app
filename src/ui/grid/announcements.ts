/**
 * Screen-reader announcements for card changes (spec › Accessibility): the app compares the card
 * list before and after each change and speaks what happened through the one polite live region
 * (`Announcer.svelte`). Diffing the list, rather than announcing from each button, covers every
 * source of change alike: buttons, keyboard, palette, notifications and the alarm settling.
 *
 * Announced: a card added or moved, a timer or stopwatch started, paused, resumed, restarted or
 * reset (with the time it starts from or stopped at), a timer's time up and its alarm dismissed.
 * Never per second. Deletes are not announced here: the app announces them with the undo hint.
 */
import {
  formatCountdown,
  formatElapsed,
  type cards,
  type StopwatchState,
  type TimerState,
} from '../../core'

/** What happened to a timer between two phases, or null when nothing worth saying did. */
function timerChange(before: TimerState, after: TimerState): string | null {
  if (before.phase === after.phase) return null
  switch (after.phase) {
    case 'running':
      // From pause it runs on with the time that was left; otherwise with the whole duration.
      if (before.phase === 'paused') return `resumed, ${formatCountdown(before.remaining)}`
      if (before.phase === 'ringing') return `restarted, ${formatCountdown(after.duration)}`
      return `started, ${formatCountdown(after.duration)}`
    case 'paused':
      return `paused, ${formatCountdown(after.remaining)}`
    case 'ringing':
      return "time's up"
    case 'idle':
      return before.phase === 'ringing' ? 'dismissed' : 'reset'
  }
}

function stopwatchChange(before: StopwatchState, after: StopwatchState): string | null {
  if (before.phase === after.phase) return null
  switch (after.phase) {
    case 'running':
      return before.phase === 'paused' ? 'resumed' : 'started'
    case 'paused':
      return `paused, ${formatElapsed(after.accumulated)}`
    case 'idle':
      return 'reset'
  }
}

/**
 * "Moved Tea to position 2 of 3" when `after` holds the same cards as `before` in another order,
 * else null. A move takes one card out and puts it back elsewhere; that is the selected card
 * (Ctrl+Arrow, the drag handle and dragging all select the card they move) or, failing that, the
 * card that moved furthest.
 */
function describeMove(before: cards.CardList, after: cards.CardList): string | null {
  const count = after.cards.length
  if (before.cards.length !== count) return null
  const was = new Map<cards.CardId, number>()
  before.cards.forEach((card, index) => was.set(card.id, index))
  let moved: { name: string; index: number; distance: number } | null = null
  for (let index = 0; index < count; index++) {
    const card = after.cards[index]
    const from = card === undefined ? undefined : was.get(card.id)
    if (card === undefined || from === undefined) return null
    const distance = Math.abs(index - from)
    if (distance === 0) continue
    const selected = card.id === after.selectedId
    if (moved === null || selected || distance > moved.distance) {
      moved = { name: card.name, index, distance: selected ? Infinity : distance }
    }
  }
  return moved === null ? null : `Moved ${moved.name} to position ${moved.index + 1} of ${count}`
}

function cardChange(before: cards.Card, after: cards.Card): string | null {
  if (before.kind === 'timer' && after.kind === 'timer') {
    return timerChange(before.timer, after.timer)
  }
  if (before.kind === 'stopwatch' && after.kind === 'stopwatch') {
    return stopwatchChange(before.stopwatch, after.stopwatch)
  }
  return null
}

/**
 * The announcements for going from list `before` to list `after`, in card order: "Added Tea",
 * "Tea started, 3:00", "Tea: time's up", "Moved Tea to position 2 of 3". Empty when nothing worth
 * announcing changed (a rename, a lap, the selection). `restoredId` names a card that came back
 * through undo, announced as "Restored …" instead of "Added …".
 */
export function describeChanges(
  before: cards.CardList,
  after: cards.CardList,
  restoredId: cards.CardId | null = null,
): string[] {
  if (before === after) return []
  const move = before.cards === after.cards ? null : describeMove(before, after)
  if (move !== null) return [move]
  const previous = new Map<cards.CardId, cards.Card>()
  for (const card of before.cards) previous.set(card.id, card)
  const messages: string[] = []
  for (const card of after.cards) {
    const old = previous.get(card.id)
    if (old === undefined) {
      messages.push(card.id === restoredId ? `Restored ${card.name}` : `Added ${card.name}`)
      continue
    }
    if (old === card) continue
    const change = cardChange(old, card)
    if (change === null) continue
    messages.push(change === "time's up" ? `${card.name}: time's up` : `${card.name} ${change}`)
  }
  return messages
}
