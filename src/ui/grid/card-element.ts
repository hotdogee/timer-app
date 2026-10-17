import type { cards } from '../../core'

/**
 * The element of card `id` inside `root`, or null. Skips a copy still fading out after a delete:
 * Svelte makes an outroing element inert, and an undo can put a new copy of the same card beside it.
 */
export function cardElement(
  root: ParentNode | null | undefined,
  id: cards.CardId,
): HTMLElement | null {
  return (
    root?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]:not([inert] *)`) ?? null
  )
}
