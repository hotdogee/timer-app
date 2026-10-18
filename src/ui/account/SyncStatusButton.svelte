<!--
  @component
  The action bar's sync status button (plan › Account UI), left of ⚙ while signed in: a cloud
  that is ticked while online, turning while connecting and struck through while offline or not
  syncing. Its name says the status ("Account: Synced") and it opens Settings › Account. An
  `IconButton` with the status in `data-sync-status`.

  ```svelte
  <SyncStatusButton status={remoteSync.status} onclick={() => openSettings('account')} />
  ```
-->
<script lang="ts">
  import { m } from '../../i18n'
  import IconButton from '../primitives/IconButton.svelte'
  import { syncIcon, syncStatusShortText } from './status'
  import type { SyncStatus } from './types'

  interface Props {
    status: SyncStatus
    onclick: () => void
  }

  let { status, onclick }: Props = $props()

  const label = $derived(m.action_bar_account({ status: syncStatusShortText(status) }))
</script>

<IconButton icon={syncIcon(status)} {label} data-sync-status={status} {onclick} />
