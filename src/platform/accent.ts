/**
 * The OS accent color, the default theme seed (spec Q20). Browsers do not expose it: the CSS
 * `AccentColor` system color resolves to a fixed value in every engine to prevent fingerprinting,
 * so the web source answers null and the theme falls back to its default seed. The desktop source
 * (M5) asks the OS through Tauri.
 */

/** Reads the platform accent color. */
export interface AccentSource {
  /** The accent as `#rrggbb`, or null when the platform does not expose one. Never rejects. */
  get(): Promise<string | null>
}

/** The web accent source: always null (see the module comment; it does not probe `AccentColor`). */
export const webAccent: AccentSource = {
  get: () => Promise.resolve(null),
}
