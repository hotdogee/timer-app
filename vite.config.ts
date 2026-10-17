import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import pkg from './package.json' with { type: 'json' }

/** Set by `tauri dev` when targeting a physical mobile device; the dev server must listen on it. */
const tauriDevHost = process.env.TAURI_DEV_HOST
/** Tauri sets this to 'true' for `tauri dev` and `tauri build --debug`. */
const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true'
/** The oldest engines the app supports: the first with container queries and :has(). */
const browserTargets = ['chrome105', 'edge105', 'firefox110', 'safari16']
/**
 * Set by Vitest. The tests skip the Paraglide plugin: `pnpm test` compiles the messages first
 * (`pnpm i18n:compile`), and each Vitest project would otherwise recompile into the same folder.
 */
const vitest = process.env.VITEST !== undefined

// Tauri-friendly settings follow https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [
    svelte(),
    // Keep these options in step with the `i18n:compile` script in package.json.
    ...(vitest
      ? []
      : [
          paraglideVitePlugin({
            project: './project.inlang',
            outdir: './src/paraglide',
            strategy: ['globalVariable', 'baseLocale'],
            emitTsDeclarations: true,
          }),
        ]),
    VitePWA({
      // The app shows its own "Update ready" snackbar; src/pwa.ts registers the service worker.
      registerType: 'prompt',
      injectRegister: false,
      // The precache already has every icon and the favicon (globPatterns covers public/), so the
      // plugin's own lists would only add each of them a second time.
      includeManifestIcons: false,
      manifest: {
        name: 'Timer App',
        short_name: 'Timer',
        description: 'A keyboard-first timer and stopwatch.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#0B57D0',
        background_color: '#ededf7',
        lang: 'en',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app, fonts included. The plugin adds manifest.webmanifest itself; matching it
        // here too would list it twice.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    // The About section shows it.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
    rolldownOptions: {
      treeshake: {
        // TinyBase's main module defines createQueries, createIndexes, createMetrics,
        // createRelationships, createCheckpoints and createMiddleware as top-level
        // `getCreateFunction(…)` calls without a pure annotation, so all of them (about 15 kB
        // minified) would stay in the main chunk although the app uses none. The call only
        // builds a factory and has no side effects.
        manualPureFunctions: ['getCreateFunction'],
      },
    },
  },
})
