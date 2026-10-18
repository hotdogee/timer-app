import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    // The tests cover the desktop code too (vite.config.ts sets it for desktop builds only).
    define: { __DESKTOP__: 'true' },
    test: {
      // Vitest blanks CSS imports by default; the precomputed theme is read as text (`?raw`), and
      // a test reads the font stacks in tokens.css.
      css: { include: [/default-theme\.css/, /tokens\.css/] },
      projects: [
        {
          // Pure modules and state, in Node. Svelte compiles for the server here, where `$effect`
          // never runs.
          extends: true,
          test: {
            name: 'unit',
            environment: 'node',
            include: ['src/**/*.test.ts'],
            exclude: [...configDefaults.exclude, 'src/**/*.client.test.ts'],
          },
        },
        {
          // State and bridges that rely on effects: the browser build of Svelte in jsdom, so
          // runes are live and `flushSync()` from 'svelte' runs pending effects. A test file that
          // uses runes itself (`$state`, `$effect.root`) must be named `*.client.test.svelte.ts`
          // so the Svelte plugin compiles it.
          extends: true,
          resolve: { conditions: ['browser'] },
          test: {
            name: 'client',
            environment: 'jsdom',
            include: ['src/**/*.client.test.ts', 'src/**/*.client.test.svelte.ts'],
          },
        },
      ],
    },
  }),
)
