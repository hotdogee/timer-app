<!--
  @component
  The keyboard shortcut cheat sheet (`?`): every shortcut, grouped (Timer, Stopwatch, Cards,
  Navigation, App), with key labels for this platform (`Ctrl+K` or `⌘K`) from the current
  bindings. Esc, the close button, a backdrop click or the help shortcut again closes it. It opens
  with focus on the close button. The modal dialog makes the page inert, so it carries its own copy
  of the app's live region: a timer that ends meanwhile is still announced.

  ```svelte
  <KeyboardHelp bind:open />
  ```
-->
<script lang="ts">
  import { keymap } from '../core'
  import { m } from '../i18n'
  import { detectKeyPlatform } from '../state/keyboard.svelte'
  import Announcer from './Announcer.svelte'
  import KeyLabel from './KeyLabel.svelte'
  import { helpSections } from './palette/shortcuts'
  import Dialog from './primitives/Dialog.svelte'
  import IconButton from './primitives/IconButton.svelte'

  interface Props {
    /** Whether the cheat sheet is shown. Bindable; it sets this to false when it closes. */
    open?: boolean
    /** The shortcuts to list. */
    bindings?: keymap.Bindings
    /** The modifier convention for key labels. */
    platform?: keymap.Platform
  }

  let {
    open = $bindable(false),
    bindings = keymap.DEFAULT_BINDINGS,
    platform = detectKeyPlatform(),
  }: Props = $props()

  const uid = $props.id()
  const headingId = `${uid}-heading`

  const sections = $derived(helpSections(bindings, platform))

  function handleKeydown(event: KeyboardEvent): void {
    // The help shortcut toggles the sheet, like the palette shortcut toggles the palette.
    if (event.isComposing) return
    if (keymap.resolveAction(bindings, keymap.keyEventForMatching(event), platform) !== 'help') {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    open = false
  }
</script>

<Dialog
  bind:open
  aria-labelledby={headingId}
  style="--dialog-width: 48rem"
  onkeydown={handleKeydown}
>
  <div class="header">
    <h2 id={headingId}>{m.help_title()}</h2>
    <!-- Focus starts on a named control, not on the scrolling content. -->
    <IconButton
      icon="close"
      label={m.common_close()}
      autofocus
      onclick={() => {
        open = false
      }}
    />
  </div>
  <div class="sections">
    {#each sections as section, index (section.title)}
      <section aria-labelledby={`${uid}-section-${String(index)}`}>
        <h3 id={`${uid}-section-${String(index)}`}>{section.title}</h3>
        <dl>
          {#each section.rows as row (row.label)}
            <div class="row">
              <dt>{row.label}</dt>
              <dd>
                {#if row.modifier}<kbd>{row.modifier}</kbd><span class="plus">+</span>{/if}
                {#each row.keys as key, k (k)}<kbd><KeyLabel label={key} /></kbd>{/each}
              </dd>
            </div>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
  <Announcer />
</Dialog>

<style>
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-block-end: var(--space-4);
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 2rem;
  }

  .sections {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 19rem), 1fr));
    gap: var(--space-5) var(--space-6);
  }

  h3 {
    margin: 0 0 var(--space-2);
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: 0.00714em;
  }

  dl {
    margin: 0;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    min-block-size: 2.25rem;
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
  }

  .row:last-child {
    border-block-end: none;
  }

  dt {
    min-inline-size: 0;
    font-size: 0.875rem;
  }

  dd {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
    margin: 0;
  }

  .plus {
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.8125rem;
  }

  kbd {
    min-inline-size: 1.75rem;
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--md-sys-color-outline-variant);
    border-radius: var(--radius-small, 8px);
    background: var(--md-sys-color-surface-container-highest);
    color: var(--md-sys-color-on-surface);
    font-family: var(--font-ui);
    font-size: 0.8125rem;
    line-height: 1.5;
    text-align: center;
    white-space: nowrap;
  }
</style>
