<!--
  @component
  The desktop app's update prompt (plan › UI › Update prompt), the desktop twin of the web's
  "Update ready" snackbar: when a check finds an update, "Update 1.2.0 available" with "Install and
  restart" and "Later" (which waits for a newer version), then the download's progress
  ("Downloading the update (45%)…"), "Installing the update…" and "Restarting…"; a failed install
  says so with "Try again" and "Later". Every message is announced politely. It stays until one is
  chosen, so keyboard and screen-reader users can reach it. Shows nothing on the web.

  The state is `desktopUpdates` (`pwa.svelte.ts`), shared with Settings › About's updates row (and
  its wording, `updateStatusText`); the app starts the checks (`startDesktopUpdateChecks`). Pass
  `blocked` while another snackbar or a dialog shows (one snackbar at a time; a modal makes the
  page inert). Choosing a button takes it away, so `onleave` runs first, while the focus is still
  on it: the app moves the focus back to the cards when it was in the snackbar.

  ```svelte
  <UpdatePrompt blocked={removed !== null || dialogOpen} onleave={refocusCards} />
  ```
-->
<script lang="ts">
  import { localeState, m } from '../i18n'
  import { desktopUpdates, type DesktopUpdates } from '../pwa.svelte'
  import Snackbar from './primitives/Snackbar.svelte'
  import { updateStatusText } from './update-status'

  interface Props {
    /** Another snackbar or a dialog is showing: wait. */
    blocked?: boolean
    /** The update state; the app's by default. */
    updates?: DesktopUpdates
    /** Runs when a button is chosen, before it goes away (so focus can move elsewhere). */
    onleave?: () => void
  }

  let { blocked = false, updates = desktopUpdates, onleave }: Props = $props()

  const phase = $derived(updates.phase)
  const offering = $derived(phase === 'available' || phase === 'failed')
  const message = $derived(updateStatusText(updates, localeState.current))

  /**
   * Whether the snackbar shows. It closes itself on either button; a new phase (the download that
   * Install starts) opens it again.
   */
  let shown = $state(false)
  $effect(() => {
    void phase
    shown = updates.prompt && !blocked
  })
</script>

<Snackbar
  bind:open={shown}
  {message}
  actionLabel={phase === 'available'
    ? m.about_update_install()
    : phase === 'failed'
      ? m.about_update_try_again()
      : ''}
  onaction={() => {
    onleave?.()
    void updates.install()
  }}
  dismissLabel={offering ? m.pwa_later() : ''}
  timeout={0}
  key={phase}
  onclose={(reason: 'timeout' | 'action' | 'dismiss') => {
    if (reason !== 'dismiss') return
    onleave?.()
    updates.later()
  }}
/>
