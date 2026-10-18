import { mount } from 'svelte'

import './app.css'
import App from './App.svelte'
import type { settings } from './core'
import { applyLocaleSetting, m } from './i18n'
import { registerPwa } from './pwa.svelte'
import { appClock } from './state/app-clock'
import { APP_TARGET, replaceAppData, startAppData, type AppData } from './state/app-data.svelte'
import { authStore } from './state/auth.svelte'
import { syncOnAfterSignOut, syncPreference } from './state/sync-preference.svelte'
import { BUILTIN_PRESETS, type Preset } from './state/presets'
import { settingsStore } from './state/settings.svelte'
import { APP_STORAGE_NAMES, appStores, openDevicePersister } from './sync'
import { DEVICE_VERIFICATION_PATH } from './sync/protocol'
import { followAccount, onSessionDoubt } from './sync/remote.svelte'
import Announcer from './ui/Announcer.svelte'
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
 * Meanwhile the session check runs (`authStore.start()`, from the first step on; the app never
 * waits for it). Once the saved data is loaded, the sync-server connection and the server-time
 * offset follow the account (`followAccount`): they run while someone is signed in and sync is on
 * for this device (Settings › Account), so the first exchange merges the saved cards with the
 * account's. When the server refuses the connection's session, the session is checked again past
 * its cookie cache, so a device signed out elsewhere (or whose account was deleted) signs out.
 * Times are app time (`appClock`: the device clock plus the server-time offset while signed in).
 *
 * Startup never ends on a blank page: if loading the data fails in a way the data layer did not
 * handle, the app still mounts, in memory, with a console warning.
 *
 * The OS accent color as the default seed comes with the desktop shell (M5): the web has none.
 */
async function start(root: HTMLElement): Promise<void> {
  authStore.start()
  const page = { appearance: null as Promise<void> | null }
  const applyDevice = (device: settings.DeviceSettings): void => {
    applyLocaleSetting(device.locale)
    page.appearance = applyAppearance(device)
  }
  let appData: Pick<AppData, 'replaceAll'>
  try {
    appData = await startAppData({
      now: appClock,
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
        replaceAppData(APP_TARGET, data, appClock())
      },
    }
  }
  onSessionDoubt(() => {
    void authStore.refresh()
  })
  syncOnAfterSignOut(() => authStore.status === 'signed-out')
  followAccount(() => (syncPreference.enabled ? (authStore.user?.id ?? null) : null))
  await page.appearance
  mount(App, { target: root, props: { appData } })
  void registerPwa()
}

/**
 * The device approval page (`/device`, the web half of the desktop app's sign-in): a page of its
 * own, without the cards. It needs the appearance, the language and the session, nothing else:
 * no card grid, alarm or keyboard layer, and no synced store (loading that in a browser that never
 * ran the app would seed a first-run timer, which signing in here would then sync into the
 * account). The page's code loads only on this path.
 */
async function startDevicePage(root: HTMLElement): Promise<void> {
  authStore.start()
  await openDevicePersister(appStores.device, APP_STORAGE_NAMES.deviceKey)
  applyLocaleSetting(settingsStore.device.locale)
  // A title of its own, for the tab, the history and screen readers.
  document.title = m.device_page_title({ title: m.device_title(), app: m.app_name() })
  const appearance = applyAppearance(settingsStore.device)
  const [{ default: DeviceApproval }] = await Promise.all([
    import('./ui/account/DeviceApproval.svelte'),
    appearance,
  ])
  // The page brings its own main landmark and heading; the live region goes after it, as in App.
  mount(DeviceApproval, { target: root })
  mount(Announcer, { target: root })
}

void (location.pathname === DEVICE_VERIFICATION_PATH ? startDevicePage(target) : start(target))
