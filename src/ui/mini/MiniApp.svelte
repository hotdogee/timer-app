<!--
  @component
  The desktop mini window's page (`/mini?card=<id>`; spec › Card header, Mini window): one card,
  compact (`MiniCard`), in a frameless always-on-top window of its own. The page has its own copy
  of the app's stores, loaded from the same storage and kept in step with the main window's over
  the tab sync, so a start here shows there at once and the other way round. The appearance and
  the language follow the device settings live, as in the main window. The main window can switch
  the card (`onswitch`, the shell's `mini-card` event); the window title follows the card's name.
  Closing (the × button, Esc, a deleted card) closes the window through the platform. Opened in a
  plain browser tab (the web's mini window is the Picture-in-Picture one, not this page), it
  offers no pin, and closing closes the tab where the browser lets a page do that.

  ```svelte
  <MiniApp cardId={miniCardId(location.search)} />
  ```
-->
<script lang="ts">
  import { cards } from '../../core'
  import { applyLocaleSetting, m } from '../../i18n'
  import { platform } from '../../platform'
  import { cardStore } from '../../state/cards.svelte'
  import { settingsStore } from '../../state/settings.svelte'
  import { applyAppearance } from '../theme/apply'
  import MiniCard from './MiniCard.svelte'

  interface Props {
    /** The card from the page's address; null shows "This card was deleted". */
    cardId: string | null
    /**
     * Subscribes to the main window's requests to show another card; returns the unsubscribe.
     * The shell's `mini-card` event by default.
     */
    onswitch?: (listener: (cardId: string) => void) => () => void
    /** Closes the window; the desktop's mini window, or the browser tab, by default. */
    onclose?: () => void
    /** Whether to offer the always-on-top pin: in the desktop app's mini window. */
    pinnable?: boolean
  }

  const desktop = platform.kind === 'tauri'

  let {
    cardId,
    onswitch = (listener) => platform.shell.onMiniCard(listener),
    onclose = () => {
      if (desktop) void platform.windows.close()
      else window.close()
    },
    pinnable = desktop && platform.windows.supported,
  }: Props = $props()

  /** The card shown: the address's, then each one the main window switches to. */
  let shown = $derived(cardId ?? '')

  $effect(() =>
    onswitch((next) => {
      shown = next
    }),
  )

  // Appearance and language follow the device settings, from this window or the main one.
  $effect(() => {
    void applyAppearance(settingsStore.device)
  })
  $effect(() => {
    applyLocaleSetting(settingsStore.device.locale)
  })

  const name = $derived(cards.findCard(cardStore.list, shown)?.name ?? '')
  $effect(() => {
    document.title = name === '' ? m.app_name() : m.mini_title({ name })
  })
</script>

{#key shown}
  <MiniCard cardId={shown} {pinnable} announceChanges {onclose} />
{/key}
