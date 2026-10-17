import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

/** Set by `tauri dev` when targeting a physical mobile device; the dev server must listen on it. */
const tauriDevHost = process.env.TAURI_DEV_HOST
/** Tauri sets this to 'true' for `tauri dev` and `tauri build --debug`. */
const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true'
/** The oldest engines the app supports: the first with container queries and :has(). */
const browserTargets = ['chrome105', 'edge105', 'firefox110', 'safari16']

// Tauri-friendly settings follow https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [svelte()],
  // Keep Rust compiler output visible when running under `tauri dev`.
  clearScreen: false,
  server: {
    port: 5173,
    // Tauri's devUrl points at this exact port, so fail rather than pick another.
    strictPort: true,
    host: tauriDevHost ?? false,
    ...(tauriDevHost ? { hmr: { protocol: 'ws', host: tauriDevHost, port: 5174 } } : {}),
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  ssr: {
    // material-color-utilities 0.4.0 ships ESM with extensionless relative imports, which Node's
    // resolver rejects. Let Vite bundle it wherever code runs in Node (Vitest).
    noExternal: ['@material/material-color-utilities'],
  },
  build: {
    // The CSS needs container queries, :has() and logical properties, so the app runs only on
    // engines that have them; the JS targets the same ones. (A lower JS target, such as Safari 13,
    // would down-level private class fields in Svelte's runtime into WeakMap helpers that run on
    // every state write.) Tauri uses WebView2 (Chromium) on Windows and WebKit on macOS and Linux.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : browserTargets,
    cssTarget: browserTargets,
    minify: !tauriDebug,
    sourcemap: tauriDebug,
  },
})
