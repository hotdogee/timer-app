<!--
  @component
  Edits the timer presets (spec › Presets): each preset's name and duration in place, moving it up
  or down, deleting it, and adding a new one at the end. A name commits when the field is left or
  on Enter (a blank name puts the old one back); Esc while editing puts the saved name back.
  Durations are typed like a card (`DurationField`). Moves and deletes are announced and keep
  keyboard focus in the list.

  ```svelte
  <PresetsEditor {presetStore} timeStyle="compact" hintId="presets-hint" />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import type { Ms, TimeStyle } from '../../core'
  import { m } from '../../i18n'
  import type { PresetStore } from '../../state/presets.svelte'
  import type { Preset } from '../../state/presets'
  import { announce } from '../announce.svelte'
  import Button from '../primitives/Button.svelte'
  import IconButton from '../primitives/IconButton.svelte'
  import TextField from '../primitives/TextField.svelte'
  import DurationField from './DurationField.svelte'
  import Glyph from './Glyph.svelte'
  import { PRESET_RANGE } from './duration'

  interface Props {
    presetStore: PresetStore
    timeStyle: TimeStyle
    /** The id of the typing hint that every duration field is described by. */
    hintId?: string | undefined
  }

  let { presetStore, timeStyle, hintId }: Props = $props()

  /** A new preset's duration. */
  const NEW_PRESET_DURATION: Ms = 5 * 60_000

  const presets = $derived(presetStore.presets)
  /** Names being typed, by preset id, until they are committed or put back. */
  let drafts = $state<Record<string, string>>({})
  let root = $state<HTMLElement>()

  type Part = 'name' | 'up' | 'down' | 'delete'

  /** A control of a preset's row: its name input or one of its buttons. */
  function control(id: string, part: Part): HTMLElement | null {
    const rows = root?.querySelectorAll<HTMLElement>('[data-preset]') ?? []
    const row = [...rows].find((element) => element.dataset.preset === id)
    return row?.querySelector<HTMLElement>(`[data-part="${part}"]`) ?? null
  }

  /** Focuses a part of a preset's row once the list has re-rendered, or `fallback` if it can't. */
  function focusLater(id: string, parts: readonly Part[], fallback?: () => void) {
    void tick().then(() => {
      for (const part of parts) {
        const element = control(id, part)
        if (element !== null && !element.matches(':disabled')) {
          element.focus()
          return
        }
      }
      fallback?.()
    })
  }

  function nameOf(preset: Preset): string {
    return drafts[preset.id] ?? preset.name
  }

  function commitName(preset: Preset) {
    const draft = drafts[preset.id]
    if (draft === undefined) return
    delete drafts[preset.id]
    presetStore.rename(preset.id, draft)
  }

  function revertName(preset: Preset): boolean {
    const draft = drafts[preset.id]
    if (draft === undefined || draft === preset.name) return false
    delete drafts[preset.id]
    return true
  }

  function add() {
    const id = presetStore.add(m.presets_new_name(), NEW_PRESET_DURATION)
    if (id === null) return
    announce(m.announce_added({ name: m.presets_new_name() }))
    void tick().then(() => {
      const input = control(id, 'name')
      if (input instanceof HTMLInputElement) {
        input.focus()
        input.select()
      }
    })
  }

  function move(preset: Preset, index: number, step: -1 | 1) {
    const to = index + step
    if (to < 0 || to >= presets.length) return
    presetStore.move(preset.id, to)
    announce(m.announce_moved({ name: preset.name, position: to + 1, count: presets.length }))
    focusLater(preset.id, step < 0 ? ['up', 'down'] : ['down', 'up'])
  }

  function remove(preset: Preset, index: number) {
    const next = presets[index + 1] ?? presets[index - 1]
    presetStore.remove(preset.id)
    delete drafts[preset.id]
    announce(m.delete_snackbar({ name: preset.name }))
    if (next === undefined) {
      void tick().then(() => root?.querySelector<HTMLElement>('[data-part="add"]')?.focus())
    } else {
      focusLater(next.id, ['delete'])
    }
  }
</script>

<div class="editor" bind:this={root}>
  {#if presets.length > 0}
    <div class="head" aria-hidden="true">
      <span>{m.presets_name()}</span>
      <span>{m.presets_duration()}</span>
    </div>
    <ul class="list">
      {#each presets as preset, index (preset.id)}
        <li class="preset" data-preset={preset.id}>
          <TextField
            class="name"
            label={m.presets_name_label()}
            hideLabel
            data-part="name"
            bind:value={() => nameOf(preset), (text: string) => (drafts[preset.id] = text)}
            autocomplete="off"
            enterkeyhint="done"
            onchange={() => {
              commitName(preset)
            }}
            onkeydown={(event: KeyboardEvent) => {
              if (event.isComposing) return
              if (event.key === 'Enter') {
                event.preventDefault()
                commitName(preset)
              } else if (event.key === 'Escape' && revertName(preset)) {
                event.preventDefault()
                event.stopPropagation()
              }
            }}
          />
          <DurationField
            class="duration"
            label={m.presets_duration_label({ name: preset.name })}
            hideLabel
            value={preset.duration}
            range={PRESET_RANGE}
            {timeStyle}
            aria-describedby={hintId}
            onchange={(duration: Ms) => {
              presetStore.setDuration(preset.id, duration)
            }}
          />
          <span class="actions">
            <Button
              variant="text"
              hideLabel
              label={m.presets_move_up({ name: preset.name })}
              icon={up}
              disabled={index === 0}
              data-part="up"
              onclick={() => {
                move(preset, index, -1)
              }}
            />
            <Button
              variant="text"
              hideLabel
              label={m.presets_move_down({ name: preset.name })}
              icon={down}
              disabled={index === presets.length - 1}
              data-part="down"
              onclick={() => {
                move(preset, index, 1)
              }}
            />
            <IconButton
              icon="delete"
              label={m.presets_delete({ name: preset.name })}
              data-part="delete"
              onclick={() => {
                remove(preset, index)
              }}
            />
          </span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">{m.presets_empty()}</p>
  {/if}
  <div class="add">
    <Button variant="tonal" icon="add" label={m.presets_add()} data-part="add" onclick={add} />
  </div>
</div>

{#snippet up()}
  <span class="glyph"><Glyph name="arrow_upward" /></span>
{/snippet}

{#snippet down()}
  <span class="glyph"><Glyph name="arrow_downward" /></span>
{/snippet}

<style>
  .editor {
    container: presets / inline-size;
  }

  .head,
  .preset {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 8.5rem calc(3 * var(--touch-target, 44px));
    align-items: center;
    gap: var(--space-2);
  }

  .head {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1rem;
    letter-spacing: 0.03em;
  }

  .head span {
    padding-inline-start: var(--space-4);
  }

  .list {
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
  }

  .preset {
    padding-block: var(--space-1);
  }

  .actions {
    display: flex;
    align-items: center;
  }

  /* Icon-only text buttons: the standard icon button look. */
  .actions :global(.button) {
    --button-padding: 0;
    --button-icon-size: 1.5rem;
    inline-size: var(--touch-target, 44px);
  }

  .glyph {
    display: inline-flex;
    color: var(--md-sys-color-on-surface-variant);
  }

  :global(.button:disabled) .glyph {
    color: inherit;
  }

  .empty {
    margin: var(--space-2) 0;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
  }

  .add {
    margin-block-start: var(--space-3);
  }

  /* Narrow: the name takes the first line; duration and buttons share the second. */
  @container presets (max-width: 26rem) {
    .head {
      display: none;
    }

    .preset {
      grid-template-columns: minmax(0, 1fr) calc(3 * var(--touch-target, 44px));
      padding-block: var(--space-2);
      border-block-end: 1px solid var(--md-sys-color-outline-variant);
    }

    .preset :global(.name) {
      grid-column: 1 / -1;
    }

    .preset:last-child {
      border-block-end: none;
    }
  }
</style>
