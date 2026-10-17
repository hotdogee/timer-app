/**
 * The app's icon set: Material Symbols (outlined, weight 400), imported as raw SVG so only these
 * icons ship. Every symbol is one `<path>` on a `0 -960 960 960` view box; we keep the path data.
 *
 * The four arrows draw the arrow keys on key caps (`KeyLabel.svelte`) and the presets' reorder
 * buttons. Play, pause and the volume icons use the filled variant, as the reference card does
 * (docs/design/card-*.png). `done` is the same glyph as `check` (Material Symbols 0.48 dropped the
 * separate file).
 */
import add from '@material-symbols/svg-400/outlined/add.svg?raw'
import arrowBack from '@material-symbols/svg-400/outlined/arrow_back.svg?raw'
import arrowDownward from '@material-symbols/svg-400/outlined/arrow_downward.svg?raw'
import arrowForward from '@material-symbols/svg-400/outlined/arrow_forward.svg?raw'
import arrowUpward from '@material-symbols/svg-400/outlined/arrow_upward.svg?raw'
import check from '@material-symbols/svg-400/outlined/check.svg?raw'
import close from '@material-symbols/svg-400/outlined/close.svg?raw'
import deleteIcon from '@material-symbols/svg-400/outlined/delete.svg?raw'
import dragIndicator from '@material-symbols/svg-400/outlined/drag_indicator.svg?raw'
import edit from '@material-symbols/svg-400/outlined/edit.svg?raw'
import flag from '@material-symbols/svg-400/outlined/flag.svg?raw'
import fullscreen from '@material-symbols/svg-400/outlined/fullscreen.svg?raw'
import fullscreenExit from '@material-symbols/svg-400/outlined/fullscreen_exit.svg?raw'
import hourglassTop from '@material-symbols/svg-400/outlined/hourglass_top.svg?raw'
import keyboard from '@material-symbols/svg-400/outlined/keyboard.svg?raw'
import moreVert from '@material-symbols/svg-400/outlined/more_vert.svg?raw'
import notifications from '@material-symbols/svg-400/outlined/notifications.svg?raw'
import pause from '@material-symbols/svg-400/outlined/pause-fill.svg?raw'
import pictureInPictureAlt from '@material-symbols/svg-400/outlined/picture_in_picture_alt.svg?raw'
import playArrow from '@material-symbols/svg-400/outlined/play_arrow-fill.svg?raw'
import restartAlt from '@material-symbols/svg-400/outlined/restart_alt.svg?raw'
import search from '@material-symbols/svg-400/outlined/search.svg?raw'
import settings from '@material-symbols/svg-400/outlined/settings.svg?raw'
import timer from '@material-symbols/svg-400/outlined/timer.svg?raw'
import undo from '@material-symbols/svg-400/outlined/undo.svg?raw'
import volumeOff from '@material-symbols/svg-400/outlined/volume_off-fill.svg?raw'
import volumeUp from '@material-symbols/svg-400/outlined/volume_up-fill.svg?raw'

const SOURCES = {
  add,
  arrow_back: arrowBack,
  arrow_downward: arrowDownward,
  arrow_forward: arrowForward,
  arrow_upward: arrowUpward,
  check,
  close,
  delete: deleteIcon,
  done: check,
  drag_indicator: dragIndicator,
  edit,
  flag,
  fullscreen,
  fullscreen_exit: fullscreenExit,
  hourglass_top: hourglassTop,
  keyboard,
  more_vert: moreVert,
  notifications,
  pause,
  picture_in_picture_alt: pictureInPictureAlt,
  play_arrow: playArrow,
  restart_alt: restartAlt,
  search,
  settings,
  timer,
  undo,
  volume_off: volumeOff,
  volume_up: volumeUp,
} as const satisfies Record<string, string>

/** An icon in the app's set, by its Material Symbols name. */
export type IconName = keyof typeof SOURCES

/** Every icon name, in alphabetical order. */
export const ICON_NAMES = Object.keys(SOURCES) as readonly IconName[]

/** The view box every Material Symbol is drawn on. */
export const ICON_VIEW_BOX = '0 -960 960 960'

const PATH_DATA = /\sd="([^"]+)"/

/** Path data for each icon, read once from its SVG source. */
const PATHS = Object.fromEntries(
  ICON_NAMES.map((name) => [name, PATH_DATA.exec(SOURCES[name])?.[1] ?? '']),
) as Readonly<Record<IconName, string>>

/** The SVG path data (`d`) of an icon, drawn on {@link ICON_VIEW_BOX}. */
export function iconPath(name: IconName): string {
  return PATHS[name]
}
