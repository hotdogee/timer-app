/**
 * The desktop mini window's page (`/mini?card=<id>`): started by `main.ts` instead of the app on
 * that path. It loads the stores like the app (the device settings first, so the theme and the
 * language are on the page before the first paint, then the synced store with the tab sync that
 * keeps it in step with the main window), then mounts the card. No sign-in, sync connection,
 * alarm or service worker: the main window does those for both.
 */
import { mount } from 'svelte'

import type { settings } from '../../core'
import { applyLocaleSetting, m } from '../../i18n'
import { appClock } from '../../state/app-clock'
import { startAppData } from '../../state/app-data.svelte'
import { settingsStore } from '../../state/settings.svelte'
import { applyAppearance } from '../theme/apply'
import MiniApp from './MiniApp.svelte'
import { miniCardId } from './mini'

/** Loads the data and mounts the mini window's page into `root`. Never rejects. */
export async function startMiniPage(
  root: HTMLElement,
  search: string = location.search,
): Promise<void> {
  const page = { appearance: null as Promise<void> | null }
  const applyDevice = (device: settings.DeviceSettings): void => {
    applyLocaleSetting(device.locale)
    page.appearance = applyAppearance(device)
  }
  try {
    await startAppData({
      now: appClock,
      onDeviceReady: applyDevice,
      get seedCardName() {
        return m.card_default_name_timer()
      },
    })
  } catch (error) {
    // As in the app: show the card anyway, from the stores as they are.
    console.warn('Timer App: could not load the saved data in the mini window', error)
    if (page.appearance === null) applyDevice(settingsStore.device)
  }
  await page.appearance
  mount(MiniApp, { target: root, props: { cardId: miniCardId(search) } })
}
