<!--
  @component
  The card icon picker: a dialog of emoji by group, with a search, that sets a card's icon.
  CardHeader loads it with `import()` the first time someone opens it, and it loads its data the
  same way (`loadEmojiDataset`, in the UI language, and again when the language changes while it
  is open), so neither is in the startup bundle.

  The search field has focus when the dialog opens. Typing filters, in the UI language and in
  English (`searchEmoji`); Enter picks the first match, ArrowDown goes to the first emoji. Without
  a query, a strip of categories jumps to each group and shows which one is in view. One emoji is
  in the tab order (the last one focused, else `current`, else the first); the arrow keys move
  through the grids (`moveInGrids`: by one, and by a row of the columns the grid shows), Home and
  End to the row's ends, Ctrl+Home and Ctrl+End to the first and last emoji, and ArrowUp from the
  first row back to the search, as does typing a character. Enter or Space picks, Esc closes; keys
  never reach the card or the app's shortcuts. Picking, or "Use the default icon" (shown while the
  card has an icon), closes the dialog.

  Emoji newer than the system's emoji font (`unsupportedVersions`) are left out, so none shows as
  a box. The dialog is modal, which makes the page inert, so it carries its own copy of the live
  region. It sits in a card's header, so it starts from the page's type and the controls' default
  sizes rather than the card's.

  ```svelte
  <EmojiPicker bind:open current={card.icon} onpick={setIcon} onclear={() => setIcon(null)} />
  ```
-->
<script lang="ts">
  import { tick, untrack } from 'svelte'

  import { localeState, m, type Locale } from '../../i18n'
  import Announcer from '../Announcer.svelte'
  import Button from '../primitives/Button.svelte'
  import Dialog from '../primitives/Dialog.svelte'
  import Icon from '../primitives/Icon.svelte'
  import IconButton from '../primitives/IconButton.svelte'
  import { loadEmojiDataset, type EmojiDataset, type EmojiEntry } from './data'
  import { LEAVE_UP, moveInGrids, type GridPosition } from './grid-nav'
  import { searchEmoji } from './search'
  import { unsupportedVersions } from './support'

  interface Props {
    /** Whether the picker is shown. Bindable; it sets this to false when it closes. */
    open?: boolean
    /** The card's icon, if it has one: shown pressed, and "Use the default icon" appears. */
    current?: string | undefined
    /** An emoji was picked; the picker has closed. */
    onpick: (emoji: string) => void
    /** "Use the default icon" was pressed; the picker has closed. */
    onclear: () => void
  }

  let { open = $bindable(false), current, onpick, onclear }: Props = $props()

  const uid = $props.id()
  const titleId = `${uid}-title`

  /** A group with emoji to show. */
  interface Section {
    readonly key: string
    readonly label: string
    readonly emoji: readonly EmojiEntry[]
  }

  let dialog = $state<HTMLDialogElement>()
  let input = $state<HTMLInputElement>()
  let list = $state<HTMLElement>()
  let query = $state('')

  /** The data shown and its language; it stays up while another language loads. */
  let loaded = $state.raw<{ readonly locale: Locale; readonly dataset: EmojiDataset } | null>(null)
  let failed = $state(false)
  /** Bumped by "Try again", which runs the loading effect again. */
  let attempt = $state(0)

  // While open, load the UI language's data: on the first opening, and when the language changes.
  $effect(() => {
    if (!open) return
    const locale = localeState.current
    void attempt
    if (untrack(() => loaded?.locale) === locale) return
    let cancelled = false
    failed = false
    loadEmojiDataset(locale).then(
      (dataset) => {
        if (!cancelled) loaded = { locale, dataset }
      },
      (error: unknown) => {
        if (cancelled) return
        // Offline before the app was cached, say. "Try again" or the next opening loads it again.
        console.warn('Timer App: could not load the emoji list', error)
        failed = true
      },
    )
    return () => {
      cancelled = true
    }
  })

  const dataset = $derived(loaded?.dataset)

  /** The emoji this system draws, in order. */
  const usable = $derived.by((): readonly EmojiEntry[] => {
    if (dataset === undefined) return []
    const hidden = unsupportedVersions(dataset.probes)
    if (hidden.size === 0) return dataset.emoji
    return dataset.emoji.filter((entry) => !hidden.has(entry[4]))
  })

  const sections = $derived.by((): readonly Section[] => {
    const groups = dataset?.groups ?? []
    const members = groups.map((): EmojiEntry[] => [])
    for (const entry of usable) members[entry[3]]?.push(entry)
    return groups.flatMap(({ key, label }, index) => {
      const emoji = members[index] ?? []
      return emoji.length > 0 ? [{ key, label, emoji }] : []
    })
  })

  const searching = $derived(query.trim() !== '')
  const results = $derived(searching ? searchEmoji(usable, query) : [])
  /** The grids on screen, in order: one per group, or the results' one. */
  const grids = $derived(
    searching ? (results.length > 0 ? [results] : []) : sections.map((section) => section.emoji),
  )

  /** The emoji last focused in the grids. */
  let lastFocused = $state<string | null>(null)
  /** The one emoji in the tab order: the last focused, else the card's, else the first. */
  const tabStop = $derived.by(() => {
    const shown = grids.flat()
    for (const wanted of [lastFocused, current]) {
      if (wanted != null && shown.some(([emoji]) => emoji === wanted)) return wanted
    }
    return shown[0]?.[0]
  })

  /** The group scrolled to the top of the list. */
  let groupInView = $state<string | null>(null)
  const pressedGroup = $derived(
    sections.some(({ key }) => key === groupInView) ? groupInView : (sections[0]?.key ?? null),
  )
  /** The category last focused: the strip's tab stop, else the pressed one. */
  let groupFocused = $state<string | null>(null)
  const groupStop = $derived(
    sections.some(({ key }) => key === groupFocused) ? groupFocused : pressedGroup,
  )

  // Each opening starts in the search field.
  $effect(() => {
    if (!open) return
    void tick().then(() => input?.focus())
  })

  function close(): void {
    // Closing the native dialog now (not on the next effect) gives focus back before the card changes.
    if (dialog?.open === true) dialog.close()
    open = false
  }

  function pick(emoji: string): void {
    close()
    onpick(emoji)
  }

  function clear(): void {
    close()
    onclear()
  }

  function handleClose(): void {
    query = ''
    lastFocused = null
    groupFocused = null
    groupInView = null
    if (list) list.scrollTop = 0
  }

  /** The grids' elements, in order. */
  function gridElements(): HTMLElement[] {
    return list ? [...list.querySelectorAll<HTMLElement>('[data-grid]')] : []
  }

  /** The emoji button at `at`, if it is on screen. */
  function buttonAt(at: GridPosition): HTMLElement | undefined {
    const button = gridElements()[at.grid]?.children[at.index]
    return button instanceof HTMLElement ? button : undefined
  }

  /** How many columns `grid` shows (its `auto-fill` tracks). */
  function columnsOf(grid: Element): number {
    return getComputedStyle(grid)
      .gridTemplateColumns.split(' ')
      .filter((track) => track !== '').length
  }

  /** A key that types a character: not Space (which presses the button) or a shortcut. */
  function typesText(event: KeyboardEvent): boolean {
    return (
      [...event.key].length === 1 &&
      event.key !== ' ' &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    )
  }

  function handleKeydown(event: KeyboardEvent): void {
    // While open, the picker owns the keyboard: nothing reaches the card or the app's shortcuts.
    event.stopPropagation()
    if (event.isComposing || event.defaultPrevented) return
    const target = event.target
    if (target === input) searchKeydown(event)
    else if (target instanceof HTMLElement && target.classList.contains('emoji')) {
      emojiKeydown(event, target)
    } else if (target instanceof HTMLElement && target.classList.contains('category')) {
      categoryKeydown(event, target)
    }
  }

  function searchKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      const first = buttonAt({ grid: 0, index: 0 })
      if (first === undefined) return
      event.preventDefault()
      first.focus()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const first = results[0]
      if (first !== undefined) pick(first[0])
    }
  }

  function emojiKeydown(event: KeyboardEvent, button: HTMLElement): void {
    if (typesText(event)) {
      // Back to the search with the character, so people can keep typing.
      event.preventDefault()
      query += event.key
      input?.focus()
      return
    }
    const grid = button.parentElement
    if (grid === null) return
    const at = { grid: gridElements().indexOf(grid), index: [...grid.children].indexOf(button) }
    const sizes = grids.map((emoji) => emoji.length)
    const to = moveInGrids(sizes, at, event.key, columnsOf(grid), event.ctrlKey || event.metaKey)
    if (to === null) return
    event.preventDefault()
    if (to === LEAVE_UP) input?.focus()
    else buttonAt(to)?.focus()
  }

  /** Left, Right, Home and End move along the category strip (a toolbar). */
  function categoryKeydown(event: KeyboardEvent, button: HTMLElement): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const buttons = [...(button.parentElement?.children ?? [])]
    const at = { grid: 0, index: buttons.indexOf(button) }
    const to = moveInGrids([buttons.length], at, event.key, buttons.length)
    if (to === null || to === LEAVE_UP) return
    event.preventDefault()
    const next = buttons[to.index]
    if (next instanceof HTMLElement) next.focus()
  }

  function handleFocusIn(event: FocusEvent): void {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.classList.contains('emoji')) lastFocused = target.textContent.trim()
    else if (target.dataset.group !== undefined) groupFocused = target.dataset.group
  }

  /** Scrolls group `key` to the top, and puts its first emoji in the tab order. */
  function showGroup(key: string): void {
    const section = list?.querySelector<HTMLElement>(`[data-section="${key}"]`)
    if (!list || !section) return
    list.scrollTop = section.offsetTop
    groupInView = key
    lastFocused = sections.find((s) => s.key === key)?.emoji[0]?.[0] ?? lastFocused
  }

  // ── The group in view ────────────────────────────────────────────────────────────────────
  // The last section whose top has scrolled to the list's top, measured once a frame at most.
  let scrollFrame = 0

  function handleScroll(): void {
    if (scrollFrame !== 0) return
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0
      if (!list) return
      const top = list.scrollTop + 1
      let inView: string | null = null
      for (const section of list.querySelectorAll<HTMLElement>('[data-section]')) {
        if (section.offsetTop > top) break
        inView = section.dataset.section ?? null
      }
      groupInView = inView
    })
  }

  $effect(() => () => {
    cancelAnimationFrame(scrollFrame)
  })
</script>

{#snippet emojiButton(entry: EmojiEntry)}
  <button
    type="button"
    class="emoji"
    tabindex={entry[0] === tabStop ? 0 : -1}
    aria-label={entry[1]}
    title={entry[1]}
    aria-pressed={entry[0] === current}
    onclick={() => {
      pick(entry[0])
    }}>{entry[0]}</button
  >
{/snippet}

<Dialog
  bind:open
  bind:element={dialog}
  aria-labelledby={titleId}
  placement="top"
  style="--dialog-width: 26rem; --dialog-padding: 0"
  onclose={handleClose}
  onkeydown={handleKeydown}
  onfocusin={handleFocusIn}
>
  <div class="picker">
    <div class="header">
      <h2 id={titleId}>{m.emoji_title()}</h2>
      <IconButton icon="close" label={m.common_close()} onclick={close} />
    </div>
    <div class="search">
      <span class="search-icon"><Icon name="search" /></span>
      <input
        bind:this={input}
        bind:value={query}
        type="search"
        aria-label={m.emoji_search_label()}
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        enterkeyhint="go"
      />
    </div>
    {#if !searching && sections.length > 0}
      <div class="categories" role="toolbar" aria-label={m.emoji_groups_label()}>
        {#each sections as section (section.key)}
          <button
            type="button"
            class="category"
            data-group={section.key}
            tabindex={section.key === groupStop ? 0 : -1}
            aria-label={section.label}
            title={section.label}
            aria-pressed={section.key === pressedGroup}
            onclick={() => {
              showGroup(section.key)
            }}>{section.emoji[0]?.[0]}</button
          >
        {/each}
      </div>
    {/if}
    <div class="list" bind:this={list} onscroll={handleScroll}>
      {#if dataset === undefined}
        {#if failed}
          <div class="message" role="alert">
            <p>{m.emoji_load_failed()}</p>
            <Button
              variant="tonal"
              label={m.about_update_try_again()}
              onclick={() => {
                attempt++
              }}
            />
          </div>
        {:else}
          <p class="message" role="status">{m.emoji_loading()}</p>
        {/if}
      {:else if searching}
        {#if results.length > 0}
          <div class="grid" data-grid role="group" aria-label={m.emoji_results_label()}>
            {#each results as entry (entry[0])}
              {@render emojiButton(entry)}
            {/each}
          </div>
        {:else}
          <p class="message" role="status">{m.emoji_no_results({ query: query.trim() })}</p>
        {/if}
      {:else}
        {#each sections as section (section.key)}
          {@const headingId = `${uid}-${section.key}`}
          <section class="section" data-section={section.key}>
            <h3 id={headingId}>{section.label}</h3>
            <div class="grid" data-grid role="group" aria-labelledby={headingId}>
              {#each section.emoji as entry (entry[0])}
                {@render emojiButton(entry)}
              {/each}
            </div>
          </section>
        {/each}
      {/if}
    </div>
    {#if current !== undefined}
      <div class="footer">
        <Button variant="text" label={m.card_icon_default()} onclick={clear} />
      </div>
    {/if}
  </div>
  <Announcer />
</Dialog>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    /* The dialog is in a card's header: the page's type and the controls' own sizes, not the card's. */
    font-size: 1rem;
    font-weight: 400;
    line-height: 1.5;
    --icon-button-color: initial;
    --icon-button-pressed-color: initial;
    --icon-button-icon-size: initial;
    --button-height: initial;
    --button-font-size: initial;
    --button-icon-size: initial;
    --button-tonal-container: initial;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding-block: var(--space-3) var(--space-2);
    padding-inline: var(--space-5) var(--space-3);
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 400;
    line-height: 2rem;
  }

  /* The command palette's search row. */
  .search {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-inline: var(--space-5);
    border-block: 1px solid var(--md-sys-color-outline-variant);
  }

  /* The field draws no ring of its own; the row's bottom edge shows where focus is. */
  .search:focus-within {
    border-block-end-color: var(--md-sys-color-primary);
    box-shadow: inset 0 -1px 0 var(--md-sys-color-primary);
  }

  .search-icon {
    display: inline-flex;
    font-size: 1.5rem;
    color: var(--md-sys-color-on-surface-variant);
  }

  input {
    flex: 1;
    min-inline-size: 0;
    min-block-size: 3rem;
    padding: 0;
    border: none;
    outline: none;
    background: transparent;
  }

  .categories {
    display: flex;
    justify-content: space-between;
    padding: var(--space-1) var(--space-2);
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .list {
    /* The sections' offsets are from here (the group in view). */
    position: relative;
    min-block-size: 8rem;
    max-block-size: min(60vh, 28rem);
    padding: 0 var(--space-2) var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* About 1,900 buttons: the browser lays out and paints only the groups near the view. */
  .section {
    content-visibility: auto;
    contain-intrinsic-size: auto 20rem;
  }

  h3 {
    position: sticky;
    inset-block-start: 0;
    z-index: 1;
    margin: 0;
    padding: var(--space-3) var(--space-2) var(--space-1);
    background: var(--md-sys-color-surface-container-high);
    color: var(--md-sys-color-primary);
    font-size: 0.875rem;
    font-weight: 500;
    letter-spacing: 0.00714em;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(var(--touch-target, 44px), 1fr));
  }

  .emoji,
  .category {
    position: relative;
    display: inline-grid;
    place-items: center;
    padding: 0;
    /* Transparent until forced-colors mode paints it. */
    border: 1px solid transparent;
    background: transparent;
    font-family: var(--font-emoji);
    line-height: 1;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }

  .emoji {
    aspect-ratio: 1;
    min-inline-size: var(--touch-target, 44px);
    border-radius: var(--radius-small, 8px);
    font-size: 1.5rem;
    /* Focus scrolls an emoji clear of the sticky group heading. */
    scroll-margin-block: 2.75rem var(--space-2);
  }

  .category {
    flex: none;
    inline-size: var(--touch-target, 44px);
    block-size: var(--touch-target, 44px);
    border-radius: var(--radius-pill, 999px);
    font-size: 1.25rem;
  }

  /* Inside the cell, so the scrolling list never clips the ring. */
  .emoji:focus-visible,
  .category:focus-visible {
    outline-offset: -2px;
  }

  .emoji[aria-pressed='true'],
  .category[aria-pressed='true'] {
    background: var(--md-sys-color-secondary-container);
  }

  /* M3 state layer, as on the icon buttons. */
  .emoji::before,
  .category::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    background: var(--md-sys-color-on-surface);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .emoji:hover::before,
  .category:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .emoji:active::before,
  .category:active::before {
    opacity: var(--state-pressed, 0.1);
  }

  .message {
    margin: 0;
    padding: var(--space-5);
    color: var(--md-sys-color-on-surface-variant);
    text-align: center;
  }

  .message p {
    margin: 0 0 var(--space-4);
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    padding: var(--space-2) var(--space-3);
    border-block-start: 1px solid var(--md-sys-color-outline-variant);
  }

  @media (forced-colors: active) {
    .emoji::before,
    .category::before {
      display: none;
    }

    .emoji[aria-pressed='true'],
    .category[aria-pressed='true'] {
      border-color: Highlight;
    }

    .search:focus-within {
      border-block-end-color: Highlight;
      box-shadow: inset 0 -1px 0 Highlight;
    }

    h3 {
      background: Canvas;
    }
  }
</style>
