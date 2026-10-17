<!--
  @component
  Settings › Data: Export saves the cards, presets and settings as a JSON file (`onexport`); Import
  reads a picked file, refuses one that is not a valid export (saying why), and otherwise asks
  "Replace your 2 cards and 4 presets with 3 cards and 5 presets from this file?" (the app's
  confirm dialog, as for deleting a card: Replace is the default, Esc cancels) before handing the
  file's data to `onimport`. The result is announced.

  ```svelte
  <DataSection cardCount={3} presetCount={4} onexport={save} onimport={(data) => appData.replaceAll(data)} />
  ```
-->
<script lang="ts">
  import type { exportFormat } from '../../core'
  import { m } from '../../i18n'
  import ConfirmDialog from '../ConfirmDialog.svelte'
  import Button from '../primitives/Button.svelte'
  import Glyph from './Glyph.svelte'
  import {
    importFailureMessage,
    readImportFile,
    type ImportFailure,
    type ImportSource,
  } from './data-file'
  import SectionHeader from './SectionHeader.svelte'
  import SettingRow from './SettingRow.svelte'
  import type { ControlIds } from './types'

  interface Props {
    /** How many cards and presets the app has now, for the import question. */
    cardCount: number
    presetCount: number
    /** Saves the export file. */
    onexport: () => void
    /** Replaces the app's cards, presets and settings with the file's (after the user agreed). */
    onimport: (data: exportFormat.ExportData) => void
  }

  let { cardCount, presetCount, onexport, onimport }: Props = $props()

  let fileInput = $state<HTMLInputElement>()
  /** The file's data while the user decides. */
  let pending = $state<exportFormat.ExportData | null>(null)
  let confirmOpen = $state(false)
  let failure = $state<ImportFailure | null>(null)
  let result = $state('')
  /** Ignores a file that finishes reading after a newer pick. */
  let reads = 0

  function countText(cards: number, presets: number) {
    return {
      cards: m.data_count_cards({ count: cards }),
      presets: m.data_count_presets({ count: presets }),
    }
  }

  async function read(file: ImportSource) {
    const read = ++reads
    failure = null
    result = ''
    const outcome = await readImportFile(file)
    if (read !== reads) return
    if (!outcome.ok) {
      failure = outcome.reason
      return
    }
    pending = outcome.data
    confirmOpen = true
  }

  function picked(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget
    const file = input.files?.[0]
    // Clear the input, so picking the same file again is a change too.
    input.value = ''
    if (file !== undefined) void read(file)
  }

  /** "Replace your 2 cards and 4 presets with 3 cards and 5 presets from this file?" */
  const importQuestion = $derived.by(() => {
    if (pending === null) return undefined
    const mine = countText(cardCount, presetCount)
    const theirs = countText(pending.cards.length, pending.presets.length)
    return m.data_import_confirm({ ...mine, fileCards: theirs.cards, filePresets: theirs.presets })
  })

  /** Replace, once the confirm dialog has closed (focus is back on Import). */
  function replace() {
    const data = pending
    pending = null
    if (data === null) return
    onimport(data)
    const counts = countText(data.cards.length, data.presets.length)
    result = m.data_import_done(counts)
  }

  function cancel() {
    pending = null
  }
</script>

<SectionHeader title={m.settings_section_data()} />

<SettingRow label={m.data_export()} description={m.data_export_description()} layout="inline">
  {#snippet control(ids: ControlIds)}
    <Button
      variant="tonal"
      id={ids.id}
      label={m.data_export()}
      icon={download}
      aria-describedby={ids.descriptionId}
      onclick={onexport}
    />
  {/snippet}
</SettingRow>

<SettingRow label={m.data_import()} description={m.data_import_description()} layout="inline">
  {#snippet control(ids: ControlIds)}
    <Button
      variant="tonal"
      id={ids.id}
      label={m.data_import()}
      icon={upload}
      aria-describedby={ids.descriptionId}
      onclick={() => fileInput?.click()}
    />
    <input
      bind:this={fileInput}
      class="file"
      type="file"
      accept=".json,application/json"
      tabindex="-1"
      aria-hidden="true"
      onchange={picked}
    />
  {/snippet}
</SettingRow>

<div class="feedback">
  <div class="failure" role="alert">
    {#if failure !== null}
      <p class="failure-title">{m.data_import_error_title()}</p>
      <p>{importFailureMessage(failure)}</p>
    {/if}
  </div>
  <p class="result" role="status">{result}</p>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  title={m.data_import_title()}
  message={importQuestion}
  confirmLabel={m.data_import_replace()}
  cancelLabel={m.common_cancel()}
  onconfirm={replace}
  oncancel={cancel}
/>

{#snippet download()}
  <Glyph name="download" />
{/snippet}

{#snippet upload()}
  <Glyph name="upload" />
{/snippet}

<style>
  .file {
    display: none;
  }

  .feedback {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-block-start: var(--space-3);
  }

  .failure:not(:empty) {
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-small, 8px);
    background: var(--md-sys-color-error-container);
    color: var(--md-sys-color-on-error-container);
  }

  .failure p {
    margin: 0;
    font-size: 0.875rem;
    line-height: 1.25rem;
  }

  .failure .failure-title {
    font-weight: 500;
  }

  .result {
    margin: 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
  }

  p {
    margin: 0;
  }

  @media (forced-colors: active) {
    .failure:not(:empty) {
      border: 1px solid CanvasText;
    }
  }
</style>
