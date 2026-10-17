<!--
  @component
  The settings dialog's section list, as a tab list: a column of Material 3 navigation items when
  `orientation` is vertical (wide dialogs), a scrollable strip of tabs when horizontal. Every
  arrow key moves to the previous or next section and shows it, Home and End go to the first and
  last; only the current tab is in the Tab order. `current` is bindable.

  Tab ids are `tabId(idPrefix, section)` (`sections.ts`); each tab controls the panel `panelId`.

  ```svelte
  <SettingsNav bind:current={section} idPrefix={uid} panelId="settings-panel" orientation="vertical" />
  ```
-->
<script lang="ts">
  import { tick } from 'svelte'

  import { m } from '../../i18n'
  import Glyph from './Glyph.svelte'
  import {
    SECTION_ICONS,
    SECTION_IDS,
    sectionTitle,
    tabId,
    tabKeyTarget,
    type SectionId,
  } from './sections'

  interface Props {
    /** The section shown. Bindable. */
    current: SectionId
    sections?: readonly SectionId[]
    /** Prefix of the tab ids, unique in the page. */
    idPrefix: string
    /** The id of the panel that shows the current section. */
    panelId: string
    orientation: 'vertical' | 'horizontal'
    /** Runs with the section the user picked. */
    onchange?: (section: SectionId) => void
  }

  let {
    current = $bindable(),
    sections = SECTION_IDS,
    idPrefix,
    panelId,
    orientation,
    onchange,
  }: Props = $props()

  let list = $state<HTMLElement>()

  function select(section: SectionId) {
    if (section === current) return
    current = section
    onchange?.(section)
  }

  function handleKeydown(event: KeyboardEvent) {
    const index = sections.indexOf(current)
    const target = tabKeyTarget(event.key, index, sections.length)
    const next = target === null ? undefined : sections[target]
    if (next === undefined || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    select(next)
    void tick().then(() => {
      const tab = list?.ownerDocument.getElementById(tabId(idPrefix, next))
      tab?.focus()
      tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
  }
</script>

<div
  bind:this={list}
  class={['nav', orientation]}
  role="tablist"
  tabindex="-1"
  aria-label={m.settings_sections()}
  aria-orientation={orientation}
  onkeydown={handleKeydown}
>
  {#each sections as section (section)}
    <button
      type="button"
      role="tab"
      class="tab"
      id={tabId(idPrefix, section)}
      aria-selected={section === current}
      aria-controls={panelId}
      tabindex={section === current ? 0 : -1}
      onclick={() => {
        select(section)
      }}
    >
      <span class="icon"><Glyph name={SECTION_ICONS[section]} /></span>
      <span class="label">{sectionTitle(section)}</span>
    </button>
  {/each}
</div>

<style>
  .nav {
    display: flex;
    outline: none;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    border: none;
    background: transparent;
    color: var(--md-sys-color-on-surface-variant);
    font-size: 0.875rem;
    font-weight: 500;
    line-height: 1.25rem;
    letter-spacing: 0.00714em;
    text-align: start;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }

  .tab::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: currentColor;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--duration-short, 150ms) var(--easing-standard, ease);
  }

  .tab:hover::before {
    opacity: var(--state-hover, 0.08);
  }

  .tab:focus-visible::before,
  .tab:active::before {
    opacity: var(--state-focus, 0.1);
  }

  .icon {
    display: inline-flex;
    font-size: 1.5rem;
  }

  /* Wide: Material 3 navigation drawer items, the current one on a pill. */
  .vertical {
    flex-direction: column;
    gap: var(--space-1);
  }

  .vertical .tab {
    min-block-size: 3.5rem;
    padding-inline: var(--space-4) var(--space-5);
    border-radius: var(--radius-pill, 999px);
  }

  /*
   * The pill alone is too faint against the dialog (about 1.1:1 light, 1.5:1 dark): an outline
   * marks the current section at 3:1 or more (WCAG 1.4.11), and its label is bolder.
   */
  .vertical .tab[aria-selected='true'] {
    background: var(--md-sys-color-secondary-container);
    box-shadow: inset 0 0 0 1px var(--md-sys-color-outline);
    color: var(--md-sys-color-on-secondary-container);
    font-weight: 700;
  }

  .vertical .tab:focus-visible {
    outline-offset: -2px;
  }

  /* Narrow: Material 3 primary tabs that scroll sideways, the current one underlined. */
  .horizontal {
    flex-direction: row;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    border-block-end: 1px solid var(--md-sys-color-outline-variant);
    scrollbar-width: none;
  }

  .horizontal::-webkit-scrollbar {
    display: none;
  }

  .horizontal .tab {
    flex: none;
    gap: var(--space-2);
    min-block-size: 3rem;
    padding-inline: var(--space-4);
  }

  .horizontal .icon {
    font-size: 1.25rem;
  }

  .horizontal .tab[aria-selected='true'] {
    color: var(--md-sys-color-primary);
  }

  .horizontal .tab[aria-selected='true']::after {
    content: '';
    position: absolute;
    inset-inline: var(--space-2);
    inset-block-end: 0;
    block-size: 3px;
    border-start-start-radius: 3px;
    border-start-end-radius: 3px;
    background: var(--md-sys-color-primary);
  }

  .horizontal .tab:focus-visible {
    outline-offset: -4px;
  }

  @media (forced-colors: active) {
    .tab::before {
      display: none;
    }

    .vertical .tab[aria-selected='true'] {
      outline: 2px solid Highlight;
      outline-offset: -2px;
    }

    .horizontal .tab[aria-selected='true']::after {
      background: Highlight;
    }
  }
</style>
