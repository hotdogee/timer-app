import { defineConfig, mergeConfig } from 'vitest/config'

import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
      // Vitest blanks CSS imports by default; the precomputed theme is read as text (`?raw`).
      css: { include: [/default-theme\.css/] },
    },
  }),
)
