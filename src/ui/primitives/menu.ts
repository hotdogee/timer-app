/**
 * Pure helpers for Menu.svelte: menu items, keyboard navigation over enabled items, and placing
 * the popover next to its trigger inside the viewport.
 */
import type { IconName } from './icons'

/** One entry in a {@link Menu}. */
export interface MenuItem {
  /** Stable key, unique within the menu. */
  readonly id: string
  readonly label: string
  /** Secondary text at the end of the row, such as a preset's duration (`3:00`). */
  readonly hint?: string
  readonly icon?: IconName
  readonly disabled?: boolean
}

/**
 * The index of the next enabled item after `from` in direction `step` (1 or -1), wrapping around.
 * `from = -1` with `step = 1` finds the first enabled item, `from = items.length` with `step = -1`
 * the last. Returns -1 when no item is enabled.
 */
export function nextEnabledIndex(items: readonly MenuItem[], from: number, step: 1 | -1): number {
  const count = items.length
  for (let offset = 1; offset <= count; offset++) {
    const index = (((from + step * offset) % count) + count) % count
    if (!items[index]?.disabled) return index
  }
  return -1
}

export type MenuPlacement = 'above' | 'below'
export type MenuAlign = 'start' | 'end'

/** The parts of a `DOMRect` the placement uses, in viewport pixels. */
export interface AnchorRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export interface MenuPosition {
  readonly top: number
  readonly left: number
  /** Where the menu ended up, after flipping if the preferred side lacked room. */
  readonly placement: MenuPlacement
}

export interface PlacementOptions {
  /** Preferred side of the anchor. */
  readonly placement: MenuPlacement
  /** Which inline edge of the anchor the menu lines up with. */
  readonly align: MenuAlign
  /** Right-to-left layout: `start` is the right edge. */
  readonly rtl: boolean
  /** Space between anchor and menu. */
  readonly gap?: number
  /** Minimum space between menu and viewport edge. */
  readonly margin?: number
}

/**
 * Places a menu of `menu` size next to `anchor` inside `viewport`: on the preferred side, or the
 * other one when only that one has room for it (else whichever has more room), aligned with the
 * anchor's start or end edge, and shifted to stay `margin` pixels inside the viewport.
 */
export function placeMenu(
  anchor: AnchorRect,
  menu: Size,
  viewport: Size,
  options: PlacementOptions,
): MenuPosition {
  const gap = options.gap ?? 4
  const margin = options.margin ?? 8

  const roomAbove = anchor.top - gap - margin
  const roomBelow = viewport.height - anchor.bottom - gap - margin
  const fitsAbove = menu.height <= roomAbove
  const fitsBelow = menu.height <= roomBelow
  let placement = options.placement
  if (placement === 'above' && !fitsAbove && (fitsBelow || roomBelow > roomAbove)) {
    placement = 'below'
  } else if (placement === 'below' && !fitsBelow && (fitsAbove || roomAbove > roomBelow)) {
    placement = 'above'
  }

  const preferredTop = placement === 'above' ? anchor.top - gap - menu.height : anchor.bottom + gap
  const top = clamp(preferredTop, margin, viewport.height - margin - menu.height)

  const alignRight = (options.align === 'end') !== options.rtl
  const preferredLeft = alignRight ? anchor.right - menu.width : anchor.left
  const left = clamp(preferredLeft, margin, viewport.width - margin - menu.width)

  return { top, left, placement }
}

/** Clamps to [min, max]; when the range is empty (too big to fit), pins to `min`. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}
