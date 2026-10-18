/**
 * The mini window's own icon: the pin of "Keep on top" (Material Symbols' `keep`, outlined and
 * filled for the pressed state), in the form of the app's icon set (`ui/primitives/icons.ts`):
 * the path data, drawn on `ICON_VIEW_BOX`.
 */
import keep from '@material-symbols/svg-400/outlined/keep.svg?raw'
import keepFill from '@material-symbols/svg-400/outlined/keep-fill.svg?raw'

const PATH_DATA = /\sd="([^"]+)"/

/** The pin's path data: `off` outlined, `on` filled. */
export const PIN_PATHS: { readonly off: string; readonly on: string } = Object.freeze({
  off: PATH_DATA.exec(keep)?.[1] ?? '',
  on: PATH_DATA.exec(keepFill)?.[1] ?? '',
})
