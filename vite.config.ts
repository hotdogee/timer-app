import { Agent } from 'node:http'

import { paraglideVitePlugin } from '@inlang/paraglide-js'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

import pkg from './package.json' with { type: 'json' }

/** Set by `tauri dev` when targeting a physical mobile device; the dev server must listen on it. */
const tauriDevHost = process.env.TAURI_DEV_HOST
/** Tauri sets this to 'true' for `tauri dev` and `tauri build --debug`. */
const tauriDebug = process.env.TAURI_ENV_DEBUG === 'true'
/** Set by the Tauri CLI (`tauri dev`, `tauri build`) to the target OS: `windows`, `macos`, … */
const tauriPlatform = process.env.TAURI_ENV_PLATFORM
/**
 * Whether this is a desktop build (`__DESKTOP__` in the code): one the Tauri CLI runs. A web build
 * leaves the desktop-only code out (the Tauri services, the shell wiring, the update prompt), so
 * the web bundle carries none of it.
 */
const desktop = tauriPlatform !== undefined
/**
 * The sync server's origin in desktop builds, which the app reaches across origins with a bearer
 * token (spec › Sync › Desktop sign-in): the desktop app is served from its own origin
 * (`http://tauri.localhost` on Windows), so the API cannot be relative as on the web. Set it with
 * `TIMER_SERVER_ORIGIN` when running the Tauri CLI; the default is the local `wrangler dev` (M6
 * sets the production origin). An explicit `VITE_API_ORIGIN` wins. Web builds keep the page's
 * own origin (see src/sync/api.ts).
 */
const desktopApiOrigin = desktop
  ? (process.env.VITE_API_ORIGIN ?? process.env.TIMER_SERVER_ORIGIN ?? 'http://localhost:8787')
  : undefined

/**
 * A release desktop build (`tauri build` without `--debug`) talks to the sync server over HTTPS
 * only: emailed codes, the device sign-in and the bearer token must never cross the network in
 * the clear, or reach whatever listens on the user's port 8787. `TIMER_ALLOW_INSECURE_ORIGIN=1`
 * lets a local release build use `http://` for testing.
 */
if (
  desktop &&
  !tauriDebug &&
  !desktopApiOrigin?.startsWith('https://') &&
  process.env.TIMER_ALLOW_INSECURE_ORIGIN !== '1'
) {
  throw new Error(
    `A release desktop build needs an https:// sync server, not ${String(desktopApiOrigin)}. ` +
      'Set TIMER_SERVER_ORIGIN=https://… (or TIMER_ALLOW_INSECURE_ORIGIN=1 for a local test build).',
  )
}
/** The oldest engines the app supports: the first with container queries and :has(). */
const browserTargets = ['chrome105', 'edge105', 'firefox110', 'safari16']
/**
 * Set by Vitest. The tests skip the Paraglide plugin: `pnpm test` compiles the messages first
 * (`pnpm i18n:compile`), and each Vitest project would otherwise recompile into the same folder.
 */
const vitest = process.env.VITEST !== undefined
/**
 * The sync server (`pnpm server:dev`, wrangler dev on port 8787). The dev and preview servers
 * forward the API, the auth routes, the sync WebSocket and the dev-only endpoints to it, so the
 * browser sees one origin: no CORS, and the session cookie is first-party. 127.0.0.1 rather than
 * localhost, because wrangler listens on IPv4 only and localhost may resolve to ::1 first.
 */
const apiTarget = 'http://127.0.0.1:8787'
/**
 * Reuses connections to wrangler. Without an agent the proxy opens a new connection for every
 * request and closes it, and under load (the end-to-end tests) Windows runs out of local ports
 * for new connections (`connect EADDRINUSE`).
 */
const apiAgent = new Agent({ keepAlive: true })
const apiProxy = {
  '/api': { target: apiTarget, ws: true, agent: apiAgent },
  '/__dev': { target: apiTarget, agent: apiAgent },
}

/** Whether a module id is part of a `@tauri-apps/*` package. */
function isTauriModule(id: string): boolean {
  return id.replaceAll('\\', '/').includes('/node_modules/@tauri-apps/')
}

/** The app's desktop-only modules, which a web build leaves out (`__DESKTOP__`). */
const DESKTOP_ONLY_MODULES = [
  /\/src\/platform\/tauri\//,
  /\/src\/state\/desktop\.svelte\.ts$/,
  /\/src\/ui\/UpdatePrompt\.svelte/,
]

/** Whether a module id is desktop-only code of the app. */
function isDesktopModule(id: string): boolean {
  const path = id.replaceAll('\\', '/')
  return DESKTOP_ONLY_MODULES.some((pattern) => pattern.test(path))
}

/**
 * Fails the build when a `@tauri-apps/*` module lands in a chunk the page loads at startup: an
 * entry chunk or any chunk it imports statically. The desktop services load through dynamic
 * `import()` (src/platform/tauri/), so the web bundle never downloads them (tech-stack.md ›
 * Principles, "Platform features sit behind interfaces"). A web build also fails when any of the
 * app's desktop-only modules ({@link DESKTOP_ONLY_MODULES}) loads at startup: `__DESKTOP__` should
 * have left them out.
 */
function tauriStaysLazy(): Plugin {
  return {
    name: 'timer-app:tauri-stays-lazy',
    apply: 'build',
    generateBundle(_options, bundle) {
      const chunks = new Map(
        Object.values(bundle).flatMap((output) =>
          output.type === 'chunk' ? [[output.fileName, output] as const] : [],
        ),
      )
      const startup = new Set<string>()
      const visit = (fileName: string): void => {
        if (startup.has(fileName)) return
        const chunk = chunks.get(fileName)
        if (chunk === undefined) return
        startup.add(fileName)
        for (const imported of chunk.imports) visit(imported)
      }
      for (const chunk of chunks.values()) if (chunk.isEntry) visit(chunk.fileName)
      for (const fileName of startup) {
        const chunk = chunks.get(fileName)
        // The modules whose code the chunk carries: a module the bundler shook out entirely is
        // still listed, with nothing rendered.
        const moduleIds = (chunk?.moduleIds ?? []).filter(
          (id) => (chunk?.modules[id]?.renderedLength ?? 0) > 0,
        )
        const tauriModule = moduleIds.find(isTauriModule)
        if (tauriModule !== undefined) {
          this.error(
            `${tauriModule} is in ${fileName}, which loads at startup. Import @tauri-apps/* ` +
              'only from src/platform/tauri/, through dynamic import().',
          )
        }
        const desktopModules = desktop ? [] : moduleIds.filter(isDesktopModule)
        if (desktopModules.length > 0) {
          this.error(
            `${desktopModules.join(', ')} ${desktopModules.length === 1 ? 'is' : 'are'} ` +
              `desktop-only but in ${fileName}, which the web build loads at startup. Reach ` +
              'desktop-only code only behind __DESKTOP__.',
          )
        }
      }
    },
  }
}

// Tauri-friendly settings follow https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [
    svelte(),
    tauriStaysLazy(),
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
        // Navigations to the server (an OAuth callback, a download from /api/export) must reach
        // the network, not the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/__dev\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  define: {
    // The About section shows it.
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DESKTOP__: JSON.stringify(desktop),
    ...(desktopApiOrigin === undefined
      ? {}
      : { 'import.meta.env.VITE_API_ORIGIN': JSON.stringify(desktopApiOrigin) }),
  },
  // Keep Rust compiler output visible when running under `tauri dev`.
  clearScreen: false,
  server: {
    port: 5173,
    // Tauri's devUrl points at this exact port, so fail rather than pick another.
    strictPort: true,
    host: tauriDevHost ?? false,
    ...(tauriDevHost ? { hmr: { protocol: 'ws', host: tauriDevHost, port: 5174 } } : {}),
    // wrangler dev writes its local D1 and Durable Object state under server/.wrangler.
    watch: { ignored: ['**/src-tauri/**', '**/.wrangler/**'] },
    proxy: apiProxy,
  },
  preview: { proxy: apiProxy },
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
