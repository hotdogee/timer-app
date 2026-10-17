/**
 * Index math for reordering cards on the grid by pointer drag (edit mode). Pure: callers measure
 * the grid once when a drag starts and pass the slot rectangles in, so nothing here touches the
 * DOM. All coordinates are page coordinates (client position plus scroll), so a drag survives
 * scrolling. Arrow-key moves use the card list's grid geometry (`cards.moveNeighbor`).
 */

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Rect {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.left &&
    point.x < rect.left + rect.width &&
    point.y >= rect.top &&
    point.y < rect.top + rect.height
  )
}

/** Distance from `value` to the range [start, end]; 0 inside it. */
function gap(value: number, start: number, end: number): number {
  return Math.max(start - value, 0, value - end)
}

/** The slot containing `point`, or -1 when it is in a gap or outside every slot. */
export function slotAt(slots: readonly Rect[], point: Point): number {
  return slots.findIndex((slot) => contains(slot, point))
}

/**
 * The slot nearest to `point` in grid terms: first the row whose vertical band is closest (slots
 * that share a `top` form a row), then the slot in that row that is closest horizontally. So a point
 * in the empty end of a short last row picks that row's last card. Ties go to the earlier slot.
 * -1 when there are no slots or the point is not finite.
 */
export function nearestSlot(slots: readonly Rect[], point: Point): number {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return -1
  let rowTop = Number.NaN
  let rowDistance = Number.POSITIVE_INFINITY
  for (const slot of slots) {
    if (slot.top === rowTop) continue
    const bottom = Math.max(...slots.filter((s) => s.top === slot.top).map((s) => s.top + s.height))
    const d = gap(point.y, slot.top, bottom)
    if (d < rowDistance) {
      rowTop = slot.top
      rowDistance = d
    }
  }
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  slots.forEach((slot, index) => {
    if (slot.top !== rowTop) return
    const d = gap(point.x, slot.left, slot.left + slot.width)
    if (d < bestDistance) {
      best = index
      bestDistance = d
    }
  })
  return best
}

/**
 * Where a dragged card belongs while the pointer is at `point`: the slot under the pointer, else
 * the nearest slot (so dragging past the last card moves it to the end). Keeps `current` when there
 * are no slots or the point is not finite.
 */
export function dropIndex(slots: readonly Rect[], point: Point, current: number): number {
  const under = slotAt(slots, point)
  if (under >= 0) return under
  const nearest = nearestSlot(slots, point)
  return nearest >= 0 ? nearest : current
}

/**
 * The translation that keeps the dragged card under the pointer while its layout box sits in slot
 * `index`: `grab` is where the pointer held the card, relative to the card's top-left corner.
 */
export function dragTranslation(
  slots: readonly Rect[],
  index: number,
  point: Point,
  grab: Point,
): Point {
  const slot = slots[index]
  if (slot === undefined) return { x: 0, y: 0 }
  return { x: point.x - grab.x - slot.left, y: point.y - grab.y - slot.top }
}

/**
 * How far to scroll the page while dragging near its top or bottom edge: negative near the top,
 * positive near the bottom, growing to `maxStep` pixels at the edge; 0 elsewhere.
 */
export function edgeScroll(y: number, viewportHeight: number, edge = 48, maxStep = 24): number {
  if (!Number.isFinite(y) || viewportHeight <= 0 || edge <= 0) return 0
  if (y < edge) return -Math.round(maxStep * Math.min(1, (edge - y) / edge))
  const fromBottom = viewportHeight - y
  if (fromBottom < edge) return Math.round(maxStep * Math.min(1, (edge - fromBottom) / edge))
  return 0
}
