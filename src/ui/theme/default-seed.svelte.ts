/**
 * The seed the page uses for the seed setting `''` (the default), when it is not Google blue: the
 * OS accent color in the desktop app (spec Q20). Reactive, so Settings › Appearance shows the color
 * actually in use and says that it follows the system. `apply.ts` writes it for the page's own
 * document whenever the default seed changes (at startup, and live when the OS accent changes).
 */
export const defaultSeedState: { current: string | null } = $state({ current: null })
