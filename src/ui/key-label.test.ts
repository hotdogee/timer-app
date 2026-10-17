import { describe, expect, it } from 'vitest'

import { keyLabelParts } from './key-label'

describe('keyLabelParts', () => {
  it('keeps a label without arrows as one piece of text', () => {
    expect(keyLabelParts('Ctrl+K')).toEqual([{ text: 'Ctrl+K' }])
    expect(keyLabelParts('?')).toEqual([{ text: '?' }])
    expect(keyLabelParts('')).toEqual([])
  })

  it('splits out each arrow key with its icon', () => {
    expect(keyLabelParts('Ctrl+↑')).toEqual([
      { text: 'Ctrl+' },
      { text: '↑', arrow: 'arrow_upward' },
    ])
    expect(keyLabelParts('⌃←')).toEqual([{ text: '⌃' }, { text: '←', arrow: 'arrow_back' }])
    expect(keyLabelParts('→')).toEqual([{ text: '→', arrow: 'arrow_forward' }])
    expect(keyLabelParts('↓')).toEqual([{ text: '↓', arrow: 'arrow_downward' }])
  })

  it('reads back to the label', () => {
    for (const label of ['Ctrl+↑', '⌃⇧→', 'Shift+N', '←', 'Alt+↓x']) {
      expect(
        keyLabelParts(label)
          .map((part) => part.text)
          .join(''),
      ).toBe(label)
    }
  })
})
