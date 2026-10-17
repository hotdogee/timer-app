import { mount } from 'svelte'

import './app.css'
import App from './App.svelte'
import { platform } from './platform'
import { DEFAULT_THEME_CSS } from './ui/theme/default-theme'
import { isDefaultSeed, resolveSeed } from './ui/theme/seed'
import { writeThemeStyle } from './ui/theme/style'

/** How long startup waits for the OS accent color before theming with the default seed. */
const ACCENT_TIMEOUT_MS = 50

const target = document.getElementById('app')
if (!target) {
  throw new Error('Timer App: mount element #app is missing from index.html')
}

/**
 * Themes the page for `seed`. The default seed's theme is precomputed text, so the common case
 * (always, on the web) skips the color library; any other seed loads it first.
 */
async function theme(seed: string): Promise<void> {
  if (isDefaultSeed(seed)) {
    writeThemeStyle(DEFAULT_THEME_CSS)
    return
  }
  try {
    const { applyTheme } = await import('./ui/theme/scheme')
    applyTheme(seed)
  } catch (error) {
    // The generator failed to load (offline without it cached, say): the default theme still works.
    console.warn('Timer App: could not build the theme; using the default', error)
    writeThemeStyle(DEFAULT_THEME_CSS)
  }
}

// Theme before mount, so the first frame has its colors. The accent gets ACCENT_TIMEOUT_MS; after
// that the app starts with the default seed, and an accent that arrives later re-themes it.
void resolveSeed(
  () => platform.accent.get(),
  ACCENT_TIMEOUT_MS,
  (late) => void theme(late),
).then(async (seed) => {
  await theme(seed)
  mount(App, { target })
})
