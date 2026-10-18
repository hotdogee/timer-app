/**
 * The OS accent color, the default theme seed (spec Q20). Browsers do not expose it: the CSS
 * `AccentColor` system color resolves to a fixed value in every engine to prevent fingerprinting,
 * so the web source answers null and the theme falls back to its default seed. The desktop source
 * (`tauri/services.ts`) asks the OS through the shell, and on Windows also hears when it changes.
 */

/** Reads the platform accent color. */
export interface AccentSource {
  /** The accent as `#rrggbb`, or null when the platform does not expose one. Never rejects. */
  get(): Promise<string | null>
  /**
   * Calls `listener` with the new accent (`#rrggbb`) each time the OS accent color changes, so a
   * theme that follows it can re-seed. Returns the function that unsubscribes. Sources without
   * change events (the web, macOS, Linux) never call it; a source may leave the method out.
   */
  onChange?(listener: (accent: string) => void): () => void
}

/** The web accent source: always null (see the module comment; it does not probe `AccentColor`). */
export const webAccent: AccentSource = {
  get: () => Promise.resolve(null),
  onChange: () => () => undefined,
}
