import { mount } from 'svelte'

import './app.css'
import App from './App.svelte'
import { systemClock, type settings } from './core'
import { applyLocaleSetting, m } from './i18n'
import { registerPwa } from './pwa.svelte'
import { APP_TARGET, replaceAppData, startAppData, type AppData } from './state/app-data.svelte'
import { BUILTIN_PRESETS, type Preset } from './state/presets'
import { settingsStore } from './state/settings.svelte'
import { applyAppearance } from './ui/theme/apply'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Timer App: mount element #app is missing from index.html')
}

/** The built-in presets' names in the UI language, by preset id. */
const PRESET_NAMES: Readonly<Record<string, () => string>> = {
  tea: m.preset_tea,
  pomodoro: m.preset_pomodoro,
  break: m.preset_break,
  eggs: m.preset_eggs,
}

/**
 * The presets a fresh install starts with, named in the UI language. Their ids stay fixed, so two
 * fresh devices still converge on one row per preset; names are data from then on and do not
 * follow later language changes, like a card's name.
 */
function seedPresets(): readonly Preset[] {
  return BUILTIN_PRESETS.map((preset) => ({
    ...preset,
    name: PRESET_NAMES[preset.id]?.() ?? preset.name,
  }))
}

/**
 * Startup, ordered so the first frame is right (spec › Persistence and instances; no flash of the
 * wrong theme or language):
 * 1. The device settings load from localStorage without waiting on I/O; the theme, the sizes and
 *    the language go on the page at once (`onDeviceReady`), before the browser can paint.
 * 2. The synced store loads from IndexedDB (milliseconds; it gives up after a few seconds), the
 *    first run is seeded with its names in the UI language, and every card is settled, so a
 *    timer that ended while the app was closed is ringing.
 * 3. A custom seed's colors are in (the color library loads only for a seed other than the
 *    default), and the app mounts.
 * 4. The service worker registers (production web builds only).
 *
 * Startup never ends on a blank page: if loading the data fails in a way the data layer did not
 * handle, the app still mounts, in memory, with a console warning.
 *
 * The OS accent color as the default seed comes with the desktop shell (M5): the web has none.
 */
async function start(root: HTMLElement): Promise<void> {
  const page = { appearance: null as Promise<void> | null }
  const applyDevice = (device: settings.DeviceSettings): void => {
    applyLocaleSetting(device.locale)
    page.appearance = applyAppearance(device)
  }
  let appData: Pick<AppData, 'replaceAll'>
  try {
    appData = await startAppData({
      now: systemClock,
      onDeviceReady: applyDevice,
      // Read when the first run is seeded, which is after `onDeviceReady` set the language.
      get seedPresets() {
        return seedPresets()
      },
      get seedCardName() {
        return m.card_default_name_timer()
      },
    })
  } catch (error) {
    // Storage failures are handled inside and only cost persistence; this is anything else.
    // Still show the app, on the stores as they are, in memory.
    console.warn('Timer App: could not load the saved data; running in memory', error)
    if (page.appearance === null) applyDevice(settingsStore.device)
    appData = {
      replaceAll: (data) => {
        replaceAppData(APP_TARGET, data, systemClock())
      },
    }
  }
  await page.appearance
  mount(App, { target: root, props: { appData } })
  void registerPwa()
}

void start(target)
