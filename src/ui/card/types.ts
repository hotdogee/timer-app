import type { cards } from '../../core'

/** What the grid passes to every card, whatever its kind; the card shell (`Card.svelte`) uses it. */
export interface CardShellProps {
  /** Whether this is the selected card (exactly one is; spec Q5). */
  selected: boolean
  /** Edit mode: the name becomes a field, and the delete button and drag handle appear. */
  editing: boolean
  /** Rename this card now (F2): its name field shows, focused, even outside edit mode. */
  renaming: boolean
  /** Out of reach while another card is the fullscreen overlay (native fullscreen does this). */
  inert?: boolean
  /** The rename field closed (committed or reverted). */
  onrenameend?: (() => void) | undefined
  /** The pointer went down on the drag handle (edit mode); the grid runs the drag. */
  ondragstart?: ((event: PointerEvent) => void) | undefined
  /** An arrow key on the drag handle: move this card one step. */
  onstep?: ((direction: cards.Direction) => void) | undefined
}
