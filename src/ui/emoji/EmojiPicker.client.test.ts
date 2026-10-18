import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EmojiDataset } from './data'
import EmojiPicker from './EmojiPicker.svelte'

const DATASET: EmojiDataset = {
  groups: [
    { key: 'smileys-emotion', label: 'Smileys & emotion' },
    { key: 'food-drink', label: 'Food & drink' },
  ],
  emoji: [
    ['😀', 'grinning face', 'face grin', 0, 1],
    ['🫠', 'melting face', 'melt', 0, 14],
    ['🫖', 'teapot', 'drink pot tea', 1, 13],
    ['🍵', 'teacup without handle', 'beverage cup drink handle tea', 1, 0.6],
    ['☕', 'hot beverage', 'coffee drink hot tea', 1, 0.6],
  ],
  probes: [{ version: 14, emoji: '🫠' }],
}

const load = vi.hoisted(() => vi.fn<(locale: string) => Promise<EmojiDataset>>())
const unsupported = vi.hoisted(() => vi.fn(() => new Set<number>()))

vi.mock('./data', () => ({ loadEmojiDataset: load }))
// jsdom has no 2D canvas; the drawing itself is support.test.ts's business.
vi.mock('./support', () => ({ unsupportedVersions: unsupported }))

// jsdom has <dialog> but not its modal methods: a minimal stand-in that, like the browser,
// closes synchronously and fires `close` afterwards.
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '')
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        if (!this.hasAttribute('open')) return
        this.removeAttribute('open')
        setTimeout(() => this.dispatchEvent(new Event('close')))
      },
    },
  })
})

beforeEach(() => {
  load.mockReset().mockResolvedValue(DATASET)
  unsupported.mockReset().mockReturnValue(new Set())
})

const mounted: (() => void)[] = []

afterEach(() => {
  for (const stop of mounted.splice(0)) stop()
})

/** Opens a picker and waits for its data. */
async function openPicker(current?: string) {
  const target = document.createElement('div')
  document.body.append(target)
  const onpick = vi.fn()
  const onclear = vi.fn()
  // Above the component's root, where the card and the app's shortcuts listen.
  const outside = vi.fn()
  window.addEventListener('keydown', outside)
  const app = mount(EmojiPicker, {
    target,
    props: { open: true, ...(current === undefined ? {} : { current }), onpick, onclear },
  })
  mounted.push(() => {
    void unmount(app)
    target.remove()
    window.removeEventListener('keydown', outside)
  })
  flushSync()
  await settle()
  const dialog = target.querySelector('dialog')
  const input = target.querySelector('input')
  if (dialog === null || input === null) throw new Error('no picker')
  const emoji = (): HTMLButtonElement[] => [...dialog.querySelectorAll<HTMLButtonElement>('.emoji')]
  const byLabel = (label: string): HTMLButtonElement | undefined =>
    [...dialog.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label)
  const type = async (text: string): Promise<void> => {
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
  }
  const press = async (key: string, on: Element | null = document.activeElement) => {
    on?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await settle()
  }
  return { dialog, input, emoji, byLabel, type, press, onpick, onclear, outside }
}

/** Lets the data promise, the effects and `tick()` run. */
async function settle(): Promise<void> {
  await Promise.resolve()
  await tick()
  flushSync()
}

describe('EmojiPicker', () => {
  it('loads the UI language’s data and shows each group, with the search focused', async () => {
    const { dialog, input, emoji } = await openPicker()
    expect(load).toHaveBeenCalledWith('en')
    expect(dialog.getAttribute('aria-labelledby')).toBe(dialog.querySelector('h2')?.id)
    expect(dialog.querySelector('h2')?.textContent).toBe('Choose an icon')
    expect(document.activeElement).toBe(input)
    expect([...dialog.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'Smileys & emotion',
      'Food & drink',
    ])
    expect(emoji().map((b) => b.textContent)).toEqual(['😀', '🫠', '🫖', '🍵', '☕'])
    const categories = dialog.querySelector('[role="toolbar"]')
    expect(categories?.getAttribute('aria-label')).toBe('Categories')
    expect([...(categories?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      '😀',
      '🫖',
    ])
    // One emoji, the first, is in the tab order.
    expect(emoji().map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1])
  })

  it('leaves out the versions the system cannot draw', async () => {
    unsupported.mockReturnValue(new Set([13, 14]))
    const { emoji } = await openPicker()
    expect(unsupported).toHaveBeenCalledWith(DATASET.probes)
    expect(emoji().map((b) => b.textContent)).toEqual(['😀', '🍵', '☕'])
  })

  it('searches, hiding the groups, and Enter picks the first match and closes', async () => {
    const { dialog, input, emoji, type, press, onpick } = await openPicker()
    await type('tea')
    expect(dialog.querySelector('[role="toolbar"]')).toBeNull()
    expect(dialog.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Search results',
    )
    expect(emoji().map((b) => b.getAttribute('aria-label'))).toEqual([
      'teapot',
      'teacup without handle',
      'hot beverage',
    ])
    await press('Enter', input)
    expect(onpick).toHaveBeenCalledWith('🫖')
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it('says when nothing matches', async () => {
    const { dialog, emoji, type } = await openPicker()
    await type('zebra')
    expect(emoji()).toEqual([])
    expect(dialog.querySelector('[role="status"].message')?.textContent).toBe(
      'No emoji match “zebra”',
    )
  })

  it('picks an emoji by click, and marks the current one', async () => {
    const { byLabel, onpick } = await openPicker('🍵')
    const teacup = byLabel('teacup without handle')
    expect(teacup?.getAttribute('aria-pressed')).toBe('true')
    expect(byLabel('teapot')?.getAttribute('aria-pressed')).toBe('false')
    // The current emoji is the tab stop.
    expect(teacup?.tabIndex).toBe(0)
    byLabel('hot beverage')?.click()
    expect(onpick).toHaveBeenCalledWith('☕')
  })

  it('offers the default icon only while the card has an emoji', async () => {
    const without = await openPicker()
    expect(without.byLabel('Use the default icon')).toBeUndefined()
    const button = [...without.dialog.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Use the default icon',
    )
    expect(button).toBeUndefined()

    const withIcon = await openPicker('🍵')
    const clear = [...withIcon.dialog.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === 'Use the default icon',
    )
    clear?.click()
    expect(withIcon.onclear).toHaveBeenCalledOnce()
    expect(withIcon.onpick).not.toHaveBeenCalled()
    expect(withIcon.dialog.hasAttribute('open')).toBe(false)
  })

  it('moves through the emoji with the arrow keys, and back up to the search', async () => {
    const { input, emoji, press } = await openPicker()
    await press('ArrowDown', input)
    expect(document.activeElement).toBe(emoji()[0])
    await press('ArrowRight')
    expect(document.activeElement).toBe(emoji()[1])
    // The focused emoji becomes the tab stop.
    expect(emoji().map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1, -1])
    // Into the next group.
    await press('ArrowRight')
    expect(document.activeElement).toBe(emoji()[2])
    await press('ArrowLeft')
    await press('ArrowLeft')
    await press('ArrowUp')
    expect(document.activeElement).toBe(input)
  })

  it('returns to the search with a typed character, so typing goes on', async () => {
    const { input, emoji, press } = await openPicker()
    await press('ArrowDown', input)
    expect(document.activeElement).toBe(emoji()[0])
    await press('c')
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('c')
    // Both through their tags ("cup", "coffee"), so in the dataset's order.
    expect(emoji().map((b) => b.textContent)).toEqual(['🍵', '☕'])
  })

  it('keeps every key from the card and the app', async () => {
    const { input, emoji, press, outside } = await openPicker()
    await press('n', input)
    await press('ArrowDown', input)
    await press('Escape', emoji()[0] ?? null)
    expect(outside).not.toHaveBeenCalled()
  })

  it('jumps to a group from the strip, which shows the group in view', async () => {
    const { dialog, emoji } = await openPicker()
    const [smileys, food] = [...dialog.querySelectorAll<HTMLButtonElement>('.category')]
    expect(smileys?.getAttribute('aria-pressed')).toBe('true')
    food?.click()
    flushSync()
    expect(food?.getAttribute('aria-pressed')).toBe('true')
    expect(smileys?.getAttribute('aria-pressed')).toBe('false')
    // Tab now goes into that group.
    expect(emoji().find((b) => b.tabIndex === 0)?.textContent).toBe('🫖')
  })

  it('explains a failed load, and tries again', async () => {
    load.mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { dialog, emoji } = await openPicker()
    await settle()
    const alert = dialog.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain('could not be loaded')
    expect(warn).toHaveBeenCalled()
    alert?.querySelector('button')?.click()
    await settle()
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    expect(emoji()).toHaveLength(5)
    warn.mockRestore()
  })
})
