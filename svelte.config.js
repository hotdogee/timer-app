import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

/**
 * Svelte compiler options, shared by vite-plugin-svelte, svelte-check and eslint-plugin-svelte.
 * @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig}
 */
export default {
  preprocess: vitePreprocess(),
}
