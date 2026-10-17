/**
 * Shared UI building blocks: Material 3 controls styled with the theme tokens. The settings
 * dialog's controls (SegmentedButtons, Select, Slider, Switch, TextField) are imported by path, not
 * from here: a Svelte module with styles is never tree-shaken, so a re-export here would put them
 * in the startup chunk of every page that imports this barrel.
 */
export { default as Button } from './Button.svelte'
export { default as Chip } from './Chip.svelte'
export { default as Dialog } from './Dialog.svelte'
export { default as Icon } from './Icon.svelte'
export { default as IconButton } from './IconButton.svelte'
export { default as Menu } from './Menu.svelte'
export { default as Snackbar } from './Snackbar.svelte'
export { ICON_NAMES, ICON_VIEW_BOX, iconPath, type IconName } from './icons'
export type { MenuAlign, MenuItem, MenuPlacement } from './menu'
