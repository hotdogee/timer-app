import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

/** Set by `tauri dev` when targeting a physical mobile device; the dev server must listen on it. */
const tauriDevHost = process.env.TAURI_DEV_HOST
/** Tauri sets this to 'true' for `tauri dev` and `tauri build --debug`. */
const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true'

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
  build: {
    // Tauri uses WebView2 (Chromium) on Windows and WebKit on macOS and Linux.
    target: process.env.TAURI_ENV_PLATFORM === 'windows' ? 'chrome105' : 'safari13',
    minify: !tauriDebug,
    sourcemap: tauriDebug,
  },
})
