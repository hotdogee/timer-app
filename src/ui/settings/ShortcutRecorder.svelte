<!--
  @component
  Records one key press for a shortcut. It takes focus when it appears and reports the next key
  combo through `onrecord`, read the way the keyboard controller reads keys (a character typed
  with AltGr is that character alone); held modifiers alone only show (`Ctrl+…`) and keep it
  waiting. Esc
  cancels (and keeps the dialog open); Tab, Shift+Tab or a click elsewhere move focus on and
  cancel. `error` shows a problem with the last press, such as a key that can't be a shortcut,
  and is announced.

  It is a text field so that screen readers pass key presses through to it; nothing is typed into
  it.

  ```svelte
  <ShortcutRecorder actionName="New timer" platform="other" error={problem}
    onrecord={(combo) => record(combo)} oncancel={(reason) => stop(reason)} />
  ```
-->
<script lang="ts">
  import { keymap } from '../../core'
  import { m } from '../../i18n'

  interface Props {
    /** The action being changed, in the field's accessible name. */
    actionName: string
    platform: keymap.Platform
    /** What was wrong with the last key press, shown under the field. */
    error?: string | undefined
    onrecord: (combo: keymap.KeyCombo) => void
    /** Recording stopped: Esc, or focus left the field. */
    oncancel: (reason: 'escape' | 'blur') => void
  }

  let { actionName, platform, error, onrecord, oncancel }: Props = $props()

  const uid = $props.id()
  const errorId = `${uid}-error`

  let input = $state<HTMLInputElement>()
  /** The modifiers held right now, as the start of a combo (`Ctrl+`, `⌃⇧`). */
  let held = $state('')

  $effect(() => {
    input?.focus()
  })

  function modifiersOf(event: KeyboardEvent): string {
    // AltGr (Ctrl+Alt) is no modifier: it is part of the character it types.
    const read = keymap.keyEventForMatching(event)
    const flags = {
      ctrl: read.ctrlKey,
      alt: read.altKey,
      shift: read.shiftKey,
      meta: read.metaKey,
    }
    if (!flags.ctrl && !flags.alt && !flags.shift && !flags.meta) return ''
    return `${keymap.formatCombo({ key: '', ...flags }, platform)}…`
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.isComposing) return
    const bare = !event.ctrlKey && !event.altKey && !event.metaKey
    // Tab moves focus on as usual; losing focus cancels.
    if (event.key === 'Tab' && bare) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape' && bare && !event.shiftKey) {
      oncancel('escape')
      return
    }
    if (keymap.isModifierKey(event.key)) {
      held = modifiersOf(event)
      return
    }
    held = ''
    // As the keyboard controller reads it, so an AltGr character records as the key that fires.
    onrecord(keymap.comboFromEvent(keymap.keyEventForMatching(event)))
  }

  function handleKeyup(event: KeyboardEvent) {
    if (keymap.isModifierKey(event.key)) held = modifiersOf(event)
  }
</script>

<div class="recorder">
  <input
    bind:this={input}
    class={['field', { invalid: error !== undefined }]}
    type="text"
    value={held}
    placeholder={m.shortcut_recording()}
    aria-label={m.shortcut_change_label({ action: actionName })}
    aria-describedby={errorId}
    aria-invalid={error === undefined ? undefined : true}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    onkeydown={handleKeydown}
    onkeyup={handleKeyup}
    onbeforeinput={(event) => {
      event.preventDefault()
    }}
    onblur={() => {
      oncancel('blur')
    }}
  />
  <div class="error" id={errorId} role="alert">{error ?? ''}</div>
</div>

<style>
  .recorder {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    inline-size: 17rem;
    max-inline-size: 100%;
  }

  .field {
    block-size: var(--text-field-height, 2.75rem);
    padding-inline: var(--space-3);
    border: 2px solid var(--md-sys-color-primary);
    border-radius: var(--radius-small, 8px);
    outline: none;
    background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
    color: var(--md-sys-color-on-surface);
    font-size: 0.875rem;
    text-overflow: ellipsis;
    caret-color: transparent;
  }

  .field::placeholder {
    color: var(--md-sys-color-primary);
    opacity: 1;
  }

  .field.invalid {
    border-color: var(--md-sys-color-error);
  }

  .error {
    color: var(--md-sys-color-error);
    font-size: 0.75rem;
    line-height: 1rem;
  }

  .error:empty {
    display: none;
  }

  @media (forced-colors: active) {
    .field {
      border-color: Highlight;
    }
  }
</style>
