/** Types shared by the settings components. */

/** The ids a setting row's control uses to point at the row's label and description. */
export interface ControlIds {
  /** The id for the control itself, which the row's `<label for>` names. */
  readonly id: string
  /** The id of the label, for `aria-labelledby`. */
  readonly labelId: string
  /** The id of the description, for `aria-describedby`; undefined when there is none. */
  readonly descriptionId: string | undefined
}
