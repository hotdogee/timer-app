/**
 * The word the user types to confirm deleting their account (plan › Account UI). It is the same
 * in every language, like a key name: it can be typed on any keyboard without an input method,
 * and the dialog's label says which word to type.
 */

/** The word to type: `DELETE`. */
export const DELETE_CONFIRMATION_WORD = 'DELETE'

/**
 * Whether `typed` confirms the deletion: the word, ignoring case and surrounding spaces (a phone
 * keyboard capitalizes only the first letter).
 */
export function isDeleteConfirmed(typed: string): boolean {
  return typed.trim().toUpperCase() === DELETE_CONFIRMATION_WORD
}
