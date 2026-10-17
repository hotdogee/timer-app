<!--
  @component
  The command palette (`Mod+K`, spec.md › Command palette): a search field over every command,
  each with its shortcut. Typing filters by fuzzy match; typing 1–6 digits offers
  "New timer HH:MM:SS" first. Up and Down move, Enter runs, Esc closes, and the palette shortcut
  closes it again. Running a command closes the palette first, so a command that opens another
  dialog or moves focus (rename) works from here. The modal dialog makes the page inert, so it
  carries its own copy of the app's live region.

  ```svelte
  <CommandPalette bind:open context={{ cardStore, actions, presets: BUILTIN_PRESETS, editing }} />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import { keymap } from '../../core'
  import { detectKeyPlatform } from '../../state/keyboard.svelte'
  import Announcer from '../Announcer.svelte'
  import Dialog from '../primitives/Dialog.svelte'
  import Icon from '../primitives/Icon.svelte'
  import { paletteResults, type Command, type CommandContext } from './commands'
  import { shortcutLabel } from './shortcuts'

  interface Props {
    /** Whether the palette is shown. Bindable; it sets this to false when it closes. */
    open?: boolean
    /** What the commands act on. */
    context: CommandContext
    /** The shortcuts to show next to commands (and the one that closes the palette). */
    bindings?: keymap.Bindings
    /** The modifier convention for shortcut labels. */
    platform?: keymap.Platform
  }

  let {
    open = $bindable(false),
    context,
    bindings = keymap.DEFAULT_BINDINGS,
    platform = detectKeyPlatform(),
  }: Props = $props()

  const uid = $props.id()
  const listId = `${uid}-list`

  let dialog = $state<HTMLDialogElement>()
  let input = $state<HTMLInputElement>()
  let list = $state<HTMLUListElement>()
  let query = $state('')
  let active = $state(0)

  // Rebuilt from the store while open, so titles follow the selected card.
  const results = $derived(open ? paletteResults(context, query) : [])
  const activeIndex = $derived(Math.min(active, results.length - 1))
  const activeId = $derived(activeIndex >= 0 ? optionId(activeIndex) : undefined)

  function optionId(index: number): string {
    return `${uid}-option-${String(index)}`
  }

  function shortcutOf(command: Command): string | null {
    return command.shortcut === undefined
      ? null
      : shortcutLabel(bindings, command.shortcut, platform)
  }

  // Each opening starts with an empty search and the field focused.
  $effect(() => {
    if (!open) return
    void tick().then(() => input?.focus())
  })

  // Keep the active option in view when the keyboard moves it.
  $effect(() => {
    const id = activeId
    if (id === undefined || !list) return
    for (const option of list.children) {
      if (option.id === id) option.scrollIntoView({ block: 'nearest' })
    }
  })

  function close(): void {
    // Closing the native dialog now (not on the next effect) returns focus before a command runs.
    if (dialog?.open) dialog.close()
    open = false
  }

  function runCommand(command: Command | undefined): void {
    if (command === undefined) return
    close()
    command.run()
  }

  function move(step: number): void {
    const count = results.length
    if (count === 0) return
    active = (activeIndex + step + count) % count
  }

  function handleInput(): void {
    active = 0
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'Enter':
        runCommand(results[activeIndex])
        break
      default:
        if (keymap.resolveAction(bindings, event, platform) !== 'palette') return
        close()
    }
    event.preventDefault()
    event.stopPropagation()
  }

  function handleClose(): void {
    query = ''
    active = 0
  }
</script>

<Dialog
  bind:open
  bind:element={dialog}
  label="Command palette"
  placement="top"
  style="--dialog-width: 36rem; --dialog-padding: 0"
  onclose={handleClose}
>
  <div class="search">
    <span class="search-icon"><Icon name="search" /></span>
    <input
      bind:this={input}
      bind:value={query}
      type="text"
      role="combobox"
      aria-label="Search commands"
      aria-expanded="true"
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={activeId}
      placeholder="Search, or type a duration"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="go"
      oninput={handleInput}
      onkeydown={handleKeydown}
    />
  </div>
  <ul bind:this={list} id={listId} class="results" role="listbox" aria-label="Commands">
    {#each results as command, index (command.id)}
      {@const shortcut = shortcutOf(command)}
      <li
        id={optionId(index)}
        class={['option', { active: index === activeIndex }]}
        role="option"
        aria-selected={index === activeIndex}
        tabindex="-1"
        onclick={() => {
          runCommand(command)
        }}
        onkeydown={handleKeydown}
        onmousedown={(event) => {
          // Keep focus in the search field.
          event.preventDefault()
        }}
        onpointermove={() => {
          active = index
        }}
      >
        <span class="option-icon">
          {#if command.icon}<Icon name={command.icon} />{/if}
        </span>
        <span class="title">{command.title}</span>
        {#if command.hint}<span class="hint">{command.hint}</span>{/if}
        {#if shortcut}<kbd>{shortcut}</kbd>{/if}
      </li>
    {/each}
  </ul>
  {#if results.length === 0}
    <p class="empty" role="status">No matching commands</p>
  {/if}
  <Announcer />
</Dialog>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-inline: var(--space-5);
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
  }

  .search-icon {
    display: inline-flex;
    font-size: 1.5rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  input {
    flex: 1;
    min-inline-size: 0;
    min-block-size: 3.5rem;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 1rem;
  }

  input::placeholder {
    color: var(--md-sys-color-on-surface-variant);
    opacity: 1;
  }

  .results {
    max-block-size: min(60vh, 26rem);
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
    list-style: none;
  }

  .results:empty {
    display: none;
  }

  .option {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-block-size: var(--touch-target, 44px);
    padding-inline: var(--space-3);
    border-radius: var(--radius-small, 8px);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }

  .option.active {
    background: var(--md-sys-color-secondary-container);
    color: var(--md-sys-color-on-secondary-container);
  }

  .option-icon {
    display: inline-flex;
    flex: none;
    inline-size: 1.25rem;
    font-size: 1.25rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  .active .option-icon {
    color: inherit;
  }

  .title {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hint {
    flex: none;
    max-inline-size: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
  }

  .active .hint {
    color: inherit;
  }

  kbd {
    flex: none;
    min-inline-size: 1.75rem;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-small, 8px);
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface-variant);
    font-family: var(--font-ui);
    font-size: 0.75rem;
    line-height: 1.5;
    text-align: center;
  }

  .empty {
    margin: 0;
    padding: var(--space-5);
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
  }

  @media (forced-colors: active) {
    .option.active {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }
  }
</style>
