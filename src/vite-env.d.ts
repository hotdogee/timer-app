/// <reference types="svelte" />
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/vanillajs" />

/** The app version from package.json, inlined by Vite (`define` in vite.config.ts). */
declare const __APP_VERSION__: string

/**
 * True in desktop builds (run by the Tauri CLI, which sets `TAURI_ENV_PLATFORM`; and in the unit
 * tests), false in web builds: desktop-only code behind it is left out of the web bundle
 * (vite.config.ts).
 */
declare const __DESKTOP__: boolean

interface ImportMetaEnv {
  /**
   * The sync server's origin for a build served from elsewhere (the desktop app, M5), such as
   * `https://timer.example.com`. Unset on the web, where the app and the API share one origin.
   */
  readonly VITE_API_ORIGIN?: string
}
