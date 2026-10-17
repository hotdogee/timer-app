/**
 * The theme for the default seed (`DEFAULT_SEED`), precomputed. The web has no accent color, so it
 * always starts with this theme; writing it as text lets startup skip the color library entirely
 * (it loads only for another seed). `default-theme.css` is a file snapshot of
 * `themeCss(DEFAULT_SEED)`, checked by `scheme.test.ts`; after changing the scheme, regenerate it
 * with `pnpm test -u`.
 */
import css from './default-theme.css?raw'

/** `themeCss(DEFAULT_SEED)`, without running it. */
export const DEFAULT_THEME_CSS: string = css
