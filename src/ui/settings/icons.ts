/**
 * Icons that only the settings dialog and the account pages use (section icons, export and import,
 * the account and sync status, the device approval page), in the same form as the app's icon set
 * (`ui/primitives/icons.ts`): Material Symbols, outlined weight 400, imported raw so only these
 * ship, keeping just the path data. {@link glyphPath} reads either set, so settings components
 * draw both through `Glyph.svelte`.
 */
import accountCircle from '@material-symbols/svg-400/outlined/account_circle.svg?raw'
import block from '@material-symbols/svg-400/outlined/block.svg?raw'
import bookmarks from '@material-symbols/svg-400/outlined/bookmarks.svg?raw'
import checkCircle from '@material-symbols/svg-400/outlined/check_circle.svg?raw'
import cloudDownload from '@material-symbols/svg-400/outlined/cloud_download.svg?raw'
import database from '@material-symbols/svg-400/outlined/database.svg?raw'
import devices from '@material-symbols/svg-400/outlined/devices.svg?raw'
import download from '@material-symbols/svg-400/outlined/download.svg?raw'
import info from '@material-symbols/svg-400/outlined/info.svg?raw'
import logout from '@material-symbols/svg-400/outlined/logout.svg?raw'
import openInNew from '@material-symbols/svg-400/outlined/open_in_new.svg?raw'
import palette from '@material-symbols/svg-400/outlined/palette.svg?raw'
import tune from '@material-symbols/svg-400/outlined/tune.svg?raw'
import upload from '@material-symbols/svg-400/outlined/upload.svg?raw'
import warning from '@material-symbols/svg-400/outlined/warning.svg?raw'

import { ICON_NAMES, iconPath, type IconName } from '../primitives/icons'

const SOURCES = {
  account_circle: accountCircle,
  block,
  bookmarks,
  check_circle: checkCircle,
  cloud_download: cloudDownload,
  database,
  devices,
  download,
  info,
  logout,
  open_in_new: openInNew,
  palette,
  tune,
  upload,
  warning,
} as const satisfies Record<string, string>

/** An icon of the settings dialog's own set. */
export type SettingsIconName = keyof typeof SOURCES

/** Any icon a settings component can draw: the app's set or the settings set. */
export type GlyphName = IconName | SettingsIconName

/** Every icon name of the settings set, in alphabetical order. */
export const SETTINGS_ICON_NAMES = Object.keys(SOURCES) as readonly SettingsIconName[]

const PATH_DATA = /\sd="([^"]+)"/

const PATHS = Object.fromEntries(
  SETTINGS_ICON_NAMES.map((name) => [name, PATH_DATA.exec(SOURCES[name])?.[1] ?? '']),
) as Readonly<Record<SettingsIconName, string>>

function isAppIcon(name: GlyphName): name is IconName {
  return (ICON_NAMES as readonly string[]).includes(name)
}

/** The SVG path data of `name`, from the app's set or the settings set (`ICON_VIEW_BOX`). */
export function glyphPath(name: GlyphName): string {
  return isAppIcon(name) ? iconPath(name) : PATHS[name]
}
