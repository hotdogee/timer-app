import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  ACTION_IDS,
  comboFromEvent,
  DEFAULT_BINDINGS,
  findConflicts,
  formatCombo,
  isDigitKey,
  matches,
  parseCombo,
  resolveAction,
  type ActionId,
  type Bindings,
  type KeyCombo,
  type KeyEventLike,
  type Platform,
} from './keymap'

const PLATFORMS: readonly Platform[] = ['mac', 'other']

/** A combo with only the given modifiers set. */
function c(key: string, mods: Partial<Omit<KeyCombo, 'key'>> = {}): KeyCombo {
  return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods }
}

/** A keydown event for `key` with only the given modifiers held. */
function ev(key: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike {
  return { key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }
}

/** The default bindings with some actions rebound. */
function rebind(changes: Partial<Record<ActionId, readonly string[]>>): Bindings {
  return { ...DEFAULT_BINDINGS, ...changes }
}

describe('DEFAULT_BINDINGS', () => {
  it('has an entry for every action, and ACTION_IDS lists each action once', () => {
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length)
    expect(Object.keys(DEFAULT_BINDINGS).sort()).toEqual([...ACTION_IDS].sort())
  })

  it('is frozen, list by list', () => {
    expect(Object.isFrozen(DEFAULT_BINDINGS)).toBe(true)
    expect(Object.isFrozen(ACTION_IDS)).toBe(true)
    for (const action of ACTION_IDS) expect(Object.isFrozen(DEFAULT_BINDINGS[action])).toBe(true)
  })

  it.each(PLATFORMS)('parses every default binding on %s', (platform) => {
    for (const action of ACTION_IDS) {
      for (const text of DEFAULT_BINDINGS[action]) {
        expect(parseCombo(text, platform), `${action}: ${text}`).not.toBeNull()
      }
    }
  })

  it.each(PLATFORMS)('has no conflicts on %s', (platform) => {
    expect(findConflicts(DEFAULT_BINDINGS, platform)).toEqual([])
  })

  // [event, action on every platform]
  const shared: [KeyEventLike, ActionId | null][] = [
    [ev(' '), 'toggle'],
    [ev('Enter'), 'start'],
    [ev('r'), 'reset'],
    [ev('R'), 'reset'], // Caps Lock
    [ev('l'), 'lap'],
    [ev('n'), 'newTimer'],
    [ev('N', { shiftKey: true }), 'newStopwatch'],
    [ev('Delete'), 'deleteCard'],
    [ev('F2'), 'rename'],
    [ev('e'), 'editMode'],
    [ev('f'), 'fullscreen'],
    [ev('m'), 'mute'],
    [ev('t'), 'miniWindow'],
    [ev('p'), 'presets'],
    [ev('?', { shiftKey: true }), 'help'],
    [ev('?'), 'help'],
    [ev('ArrowLeft'), 'selectLeft'],
    [ev('ArrowRight'), 'selectRight'],
    [ev('ArrowUp'), 'selectUp'],
    [ev('ArrowDown'), 'selectDown'],
    [ev('ArrowLeft', { ctrlKey: true }), 'moveLeft'],
    [ev('ArrowRight', { ctrlKey: true }), 'moveRight'],
    [ev('ArrowUp', { ctrlKey: true }), 'moveUp'],
    [ev('ArrowDown', { ctrlKey: true }), 'moveDown'],
    [ev('Escape'), 'cancel'],
    [ev('Backspace'), null],
    [ev('d'), null],
  ]

  it.each(PLATFORMS)('resolves the documented keys on %s', (platform) => {
    for (const [event, action] of shared) {
      expect(resolveAction(DEFAULT_BINDINGS, event, platform), JSON.stringify(event)).toBe(action)
    }
  })

  it('maps Mod to Cmd on macOS and to Ctrl elsewhere', () => {
    expect(resolveAction(DEFAULT_BINDINGS, ev('k', { metaKey: true }), 'mac')).toBe('palette')
    expect(resolveAction(DEFAULT_BINDINGS, ev('k', { ctrlKey: true }), 'mac')).toBeNull()
    expect(resolveAction(DEFAULT_BINDINGS, ev('k', { ctrlKey: true }), 'other')).toBe('palette')
    expect(resolveAction(DEFAULT_BINDINGS, ev('k', { metaKey: true }), 'other')).toBeNull()
    expect(resolveAction(DEFAULT_BINDINGS, ev('z', { metaKey: true }), 'mac')).toBe('undo')
    expect(resolveAction(DEFAULT_BINDINGS, ev('z', { ctrlKey: true }), 'other')).toBe('undo')
    expect(resolveAction(DEFAULT_BINDINGS, ev('z', { ctrlKey: true }), 'mac')).toBeNull()
  })
})

describe('parseCombo', () => {
  // [text, platform or both, expected]
  const valid: [string, Platform | 'both', KeyCombo][] = [
    ['Mod+K', 'other', c('k', { ctrl: true })],
    ['Mod+K', 'mac', c('k', { meta: true })],
    ['mod+k', 'mac', c('k', { meta: true })],
    ['Shift+N', 'both', c('n', { shift: true })],
    ['N', 'both', c('n')],
    ['n', 'both', c('n')],
    ['ArrowLeft', 'both', c('ArrowLeft')],
    ['arrowleft', 'both', c('ArrowLeft')],
    ['Left', 'both', c('ArrowLeft')],
    ['up', 'both', c('ArrowUp')],
    ['←', 'both', c('ArrowLeft')],
    ['Ctrl+ArrowRight', 'both', c('ArrowRight', { ctrl: true })],
    [' ', 'both', c(' ')],
    ['Space', 'both', c(' ')],
    ['space', 'both', c(' ')],
    ['Spacebar', 'both', c(' ')],
    ['Ctrl+Space', 'both', c(' ', { ctrl: true })],
    ['Esc', 'both', c('Escape')],
    ['Escape', 'both', c('Escape')],
    ['Return', 'both', c('Enter')],
    ['Del', 'both', c('Delete')],
    ['F2', 'both', c('F2')],
    ['f12', 'both', c('F12')],
    ['F24', 'both', c('F24')],
    ['MediaPlayPause', 'both', c('MediaPlayPause')],
    ['?', 'both', c('?')],
    ['Shift+?', 'both', c('?', { shift: true })],
    ['/', 'both', c('/')],
    ['+', 'both', c('+')],
    ['Ctrl++', 'both', c('+', { ctrl: true })],
    ['Ctrl+Shift++', 'both', c('+', { ctrl: true, shift: true })],
    ['Ctrl+Alt+Shift+Meta+X', 'both', c('x', { ctrl: true, alt: true, shift: true, meta: true })],
    ['CONTROL+option+cmd+K', 'both', c('k', { ctrl: true, alt: true, meta: true })],
    ['Opt+Command+K', 'both', c('k', { alt: true, meta: true })],
    ['Win+K', 'both', c('k', { meta: true })],
    ['Super+K', 'both', c('k', { meta: true })],
    ['Ctrl+Ctrl+K', 'both', c('k', { ctrl: true })],
    ['Mod+Ctrl+K', 'other', c('k', { ctrl: true })],
    [' Ctrl + K ', 'both', c('k', { ctrl: true })],
    ['⌘K', 'both', c('k', { meta: true })],
    ['⌃⌥⇧⌘K', 'both', c('k', { ctrl: true, alt: true, shift: true, meta: true })],
    ['⇧N', 'both', c('n', { shift: true })],
    ['⌃←', 'both', c('ArrowLeft', { ctrl: true })],
    ['⌘Space', 'both', c(' ', { meta: true })],
    ['⌘+', 'both', c('+', { meta: true })],
    ['é', 'both', c('é')],
    ['É', 'both', c('é')],
  ]

  it.each(valid)('parses %j on %s', (text, where, expected) => {
    for (const platform of where === 'both' ? PLATFORMS : [where]) {
      expect(parseCombo(text, platform)).toEqual(expected)
    }
  })

  const malformed = [
    '',
    '   ',
    'Ctrl+',
    'Ctrl+Shift',
    'Shift',
    'Meta',
    '+K',
    '++',
    'Ctrl+K+L',
    'K+Ctrl',
    'Hyper+K',
    'Ctrl K',
    'abc',
    'KK',
    'Ctrl+Ctrl',
    'Alt+Option',
    'Ctrl+Mod',
    'Ctrl+⌘',
    '⌘',
    '⌘⇧',
  ]

  it.each(malformed)('rejects %j', (text) => {
    for (const platform of PLATFORMS) expect(parseCombo(text, platform)).toBeNull()
  })

  it('rejects non-strings from untyped code', () => {
    const junks: unknown[] = [undefined, null, 42, {}, ['K']]
    for (const junk of junks) {
      expect(parseCombo(junk as string, 'other')).toBeNull()
    }
  })

  it('does not mistake Object.prototype member names for keys or modifiers', () => {
    for (const text of ['__proto__', 'constructor', 'toString', '__proto__+K', 'valueOf+K']) {
      for (const platform of PLATFORMS) expect(parseCombo(text, platform)).toBeNull()
    }
    expect(comboFromEvent(ev('__proto__')).key).toBe('__proto__')
    expect(formatCombo(c('constructor'), 'other')).toBe('constructor')
  })

  it('reads a bare F as the F key, not a function key', () => {
    // 'F' alone is the letter: it is one character.
    expect(parseCombo('f', 'other')).toEqual(c('f'))
  })
})

describe('formatCombo', () => {
  it('uses Ctrl+Alt+Shift+Meta+Key names elsewhere', () => {
    expect(formatCombo(c('k', { ctrl: true }), 'other')).toBe('Ctrl+K')
    expect(formatCombo(c('k', { meta: true, shift: true, alt: true, ctrl: true }), 'other')).toBe(
      'Ctrl+Alt+Shift+Meta+K',
    )
    expect(formatCombo(c('n', { shift: true }), 'other')).toBe('Shift+N')
    expect(formatCombo(c('+', { ctrl: true }), 'other')).toBe('Ctrl++')
  })

  it('uses symbols in Apple order on macOS', () => {
    expect(formatCombo(c('k', { meta: true }), 'mac')).toBe('⌘K')
    expect(formatCombo(c('k', { meta: true, shift: true, alt: true, ctrl: true }), 'mac')).toBe(
      '⌃⌥⇧⌘K',
    )
    expect(formatCombo(c('n', { shift: true }), 'mac')).toBe('⇧N')
    expect(formatCombo(c('ArrowLeft', { ctrl: true }), 'mac')).toBe('⌃←')
  })

  it.each(PLATFORMS)('labels named keys the same way on %s', (platform) => {
    expect(formatCombo(c(' '), platform)).toBe('Space')
    expect(formatCombo(c('ArrowUp'), platform)).toBe('↑')
    expect(formatCombo(c('ArrowDown'), platform)).toBe('↓')
    expect(formatCombo(c('ArrowLeft'), platform)).toBe('←')
    expect(formatCombo(c('ArrowRight'), platform)).toBe('→')
    expect(formatCombo(c('Escape'), platform)).toBe('Esc')
    expect(formatCombo(c('Enter'), platform)).toBe('Enter')
    expect(formatCombo(c('Delete'), platform)).toBe('Delete')
    expect(formatCombo(c('F2'), platform)).toBe('F2')
    expect(formatCombo(c('?'), platform)).toBe('?')
    expect(formatCombo(c('ß'), platform)).toBe('ß')
  })

  it('shows the defaults as people expect', () => {
    const show = (text: string, platform: Platform): string => {
      const combo = parseCombo(text, platform)
      return combo === null ? 'null' : formatCombo(combo, platform)
    }
    expect(show('Mod+K', 'mac')).toBe('⌘K')
    expect(show('Mod+K', 'other')).toBe('Ctrl+K')
    expect(show('Mod+Z', 'other')).toBe('Ctrl+Z')
    expect(show('Shift+N', 'other')).toBe('Shift+N')
    expect(show('r', 'other')).toBe('R')
    expect(show('Ctrl+ArrowLeft', 'other')).toBe('Ctrl+←')
    expect(show('Space', 'mac')).toBe('Space')
  })

  it('normalizes keys in hand-made combos', () => {
    expect(formatCombo(c('Spacebar'), 'other')).toBe('Space')
    expect(formatCombo(c('N'), 'other')).toBe('N')
    expect(formatCombo(c('Esc'), 'mac')).toBe('Esc')
  })
})

describe('parse and format round trips', () => {
  it.each(PLATFORMS)('reads every default binding back after formatting on %s', (platform) => {
    for (const action of ACTION_IDS) {
      for (const text of DEFAULT_BINDINGS[action]) {
        const combo = parseCombo(text, platform)
        expect(combo).not.toBeNull()
        if (combo === null) continue
        expect(parseCombo(formatCombo(combo, platform), platform)).toEqual(combo)
      }
    }
  })

  const keyArb = fc.oneof(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
    fc.constantFrom(
      'é',
      'ß',
      'ж',
      '?',
      '/',
      '+',
      ',',
      '.',
      '-',
      '=',
      '[',
      ']',
      ';',
      "'",
      '`',
      '\\',
    ),
    fc.constantFrom(
      ' ',
      'Enter',
      'Escape',
      'Tab',
      'Backspace',
      'Delete',
      'Insert',
      'Home',
      'End',
      'PageUp',
      'PageDown',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown',
      'ContextMenu',
      'MediaPlayPause',
      'AudioVolumeUp',
    ),
    fc.integer({ min: 1, max: 24 }).map((n) => `F${n}`),
  )
  const comboArb = fc.record({
    key: keyArb,
    ctrl: fc.boolean(),
    alt: fc.boolean(),
    shift: fc.boolean(),
    meta: fc.boolean(),
  })

  it.each(PLATFORMS)('parses any formatted combo back to itself on %s', (platform) => {
    fc.assert(
      fc.property(comboArb, (combo) => {
        expect(parseCombo(formatCombo(combo, platform), platform)).toEqual(combo)
      }),
      { numRuns: 1000 },
    )
  })

  it.each(PLATFORMS)('formats distinct combos differently on %s', (platform) => {
    fc.assert(
      fc.property(comboArb, comboArb, (a, b) => {
        const same = JSON.stringify(a) === JSON.stringify(b)
        expect(formatCombo(a, platform) === formatCombo(b, platform)).toBe(same)
      }),
      { numRuns: 1000 },
    )
  })

  it.each(PLATFORMS)('never throws on arbitrary text on %s', (platform) => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 12 }), (text) => {
        const combo = parseCombo(text, platform)
        if (combo !== null)
          expect(parseCombo(formatCombo(combo, platform), platform)).toEqual(combo)
      }),
      { numRuns: 1000 },
    )
  })
})

describe('comboFromEvent', () => {
  it('lowercases letters and keeps Shift as a flag', () => {
    expect(comboFromEvent(ev('N', { shiftKey: true }))).toEqual(c('n', { shift: true }))
    expect(comboFromEvent(ev('N'))).toEqual(c('n')) // Caps Lock
    expect(comboFromEvent(ev('k', { ctrlKey: true, metaKey: true }))).toEqual(
      c('k', { ctrl: true, meta: true }),
    )
  })

  it('normalizes legacy key names', () => {
    expect(comboFromEvent(ev('Spacebar')).key).toBe(' ')
    expect(comboFromEvent(ev('Esc')).key).toBe('Escape')
    expect(comboFromEvent(ev('Left')).key).toBe('ArrowLeft')
    expect(comboFromEvent(ev('Right')).key).toBe('ArrowRight')
    expect(comboFromEvent(ev('Up')).key).toBe('ArrowUp')
    expect(comboFromEvent(ev('Down')).key).toBe('ArrowDown')
    expect(comboFromEvent(ev('Del')).key).toBe('Delete')
  })

  it('keeps other keys as reported', () => {
    for (const key of [' ', 'Enter', '?', 'F2', 'Shift', 'Unidentified', 'Dead', 'AltGraph', '5']) {
      expect(comboFromEvent(ev(key)).key).toBe(key)
    }
  })

  it('reads modifier flags as booleans, even from untyped events', () => {
    const loose = { key: 'a', ctrlKey: 1, altKey: undefined, shiftKey: 'yes', metaKey: true }
    expect(comboFromEvent(loose as unknown as KeyEventLike)).toEqual(c('a', { meta: true }))
    expect(comboFromEvent({ key: undefined } as unknown as KeyEventLike)).toEqual(c(''))
  })
})

describe('matches', () => {
  it('matches a letter without Shift only when Shift is up', () => {
    expect(matches(c('n'), ev('n'))).toBe(true)
    expect(matches(c('n'), ev('N'))).toBe(true) // Caps Lock
    expect(matches(c('n'), ev('N', { shiftKey: true }))).toBe(false)
  })

  it('matches Shift+letter only when Shift is down', () => {
    expect(matches(c('n', { shift: true }), ev('N', { shiftKey: true }))).toBe(true)
    expect(matches(c('n', { shift: true }), ev('n'))).toBe(false)
  })

  it('matches ? with or without Shift, since layouts differ in how it is typed', () => {
    expect(matches(c('?'), ev('?', { shiftKey: true }))).toBe(true)
    expect(matches(c('?'), ev('?'))).toBe(true)
    expect(matches(c('?', { shift: true }), ev('?'))).toBe(true)
    expect(matches(c('?'), ev('/'))).toBe(false)
    expect(matches(c('?'), ev('?', { ctrlKey: true }))).toBe(false)
  })

  it('matches every spelling of Space but keeps Shift exact for it', () => {
    const space = parseCombo('Space', 'other')
    expect(space).not.toBeNull()
    if (space === null) return
    expect(matches(space, ev(' '))).toBe(true)
    expect(matches(space, ev('Spacebar'))).toBe(true)
    expect(matches(space, ev(' ', { shiftKey: true }))).toBe(false)
  })

  it('requires Ctrl, Alt and Meta to match exactly', () => {
    expect(matches(c('r'), ev('r', { ctrlKey: true }))).toBe(false)
    expect(matches(c('r'), ev('r', { altKey: true }))).toBe(false)
    expect(matches(c('r'), ev('r', { metaKey: true }))).toBe(false)
    expect(matches(c('k', { ctrl: true }), ev('k', { ctrlKey: true }))).toBe(true)
    expect(matches(c('k', { ctrl: true }), ev('K', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matches(c('k', { ctrl: true }), ev('k', { metaKey: true }))).toBe(false)
    expect(matches(c('k', { ctrl: true }), ev('k', { ctrlKey: true, altKey: true }))).toBe(false)
    expect(matches(c('k', { ctrl: true, shift: true }), ev('k', { ctrlKey: true }))).toBe(false)
  })

  it('normalizes the key of a hand-made combo', () => {
    expect(matches(c('N'), ev('n'))).toBe(true)
    expect(matches(c('Esc'), ev('Escape'))).toBe(true)
  })
})

describe('resolveAction', () => {
  it('returns null for unbound keys', () => {
    for (const event of [ev('x'), ev('F3'), ev('Tab'), ev('x', { ctrlKey: true }), ev('Shift')]) {
      for (const platform of PLATFORMS)
        expect(resolveAction(DEFAULT_BINDINGS, event, platform)).toBeNull()
    }
  })

  it('ignores browser shortcuts that only share a letter with a binding', () => {
    expect(resolveAction(DEFAULT_BINDINGS, ev('r', { ctrlKey: true }), 'other')).toBeNull()
    expect(resolveAction(DEFAULT_BINDINGS, ev('r', { metaKey: true }), 'mac')).toBeNull()
    expect(resolveAction(DEFAULT_BINDINGS, ev('f', { altKey: true }), 'other')).toBeNull()
    expect(
      resolveAction(DEFAULT_BINDINGS, ev('N', { shiftKey: true, ctrlKey: true }), 'other'),
    ).toBeNull()
  })

  it('returns null for digits and Backspace, even when bound, so digit entry gets them', () => {
    const bound = rebind({ start: ['5'], reset: ['Backspace'], lap: ['Shift+1'] })
    for (const platform of PLATFORMS) {
      for (let d = 0; d <= 9; d++) expect(resolveAction(bound, ev(String(d)), platform)).toBeNull()
      expect(resolveAction(bound, ev('5', { shiftKey: true }), platform)).toBeNull()
      expect(resolveAction(bound, ev('Backspace'), platform)).toBeNull()
      expect(resolveAction(bound, ev('1', { shiftKey: true }), platform)).toBeNull()
    }
  })

  it('lets digits and Backspace with Ctrl, Alt or Meta resolve', () => {
    const bound = rebind({ start: ['Ctrl+1'], reset: ['Alt+Backspace'] })
    expect(resolveAction(bound, ev('1', { ctrlKey: true }), 'other')).toBe('start')
    expect(resolveAction(bound, ev('Backspace', { altKey: true }), 'mac')).toBe('reset')
  })

  it('follows rebinding', () => {
    const bound = rebind({ reset: ['x'], help: ['F1', 'Shift+/'] })
    expect(resolveAction(bound, ev('x'), 'other')).toBe('reset')
    expect(resolveAction(bound, ev('r'), 'other')).toBeNull()
    expect(resolveAction(bound, ev('F1'), 'other')).toBe('help')
    expect(resolveAction(bound, ev('/', { shiftKey: true }), 'other')).toBe('help')
    expect(resolveAction(bound, ev('?', { shiftKey: true }), 'other')).toBeNull()
  })

  it('picks the first action in ACTION_IDS order when bindings conflict', () => {
    const bound = rebind({ lap: ['r'] })
    expect(resolveAction(bound, ev('r'), 'other')).toBe('reset')
  })

  it('skips malformed binding text and non-list entries', () => {
    const bound = rebind({ help: ['Hyper+?', '', '?'] })
    expect(resolveAction(bound, ev('?'), 'other')).toBe('help')
    const junk = { ...DEFAULT_BINDINGS, help: 'x', reset: [42, 'r'] } as unknown as Bindings
    expect(resolveAction(junk, ev('x'), 'other')).toBeNull()
    expect(resolveAction(junk, ev('r'), 'other')).toBe('reset')
    expect(resolveAction(null as unknown as Bindings, ev('r'), 'other')).toBeNull()
  })

  it('keeps results per bindings object and per platform', () => {
    const custom = rebind({ palette: ['Ctrl+P'] })
    const event = ev('k', { ctrlKey: true })
    expect(resolveAction(DEFAULT_BINDINGS, event, 'other')).toBe('palette')
    expect(resolveAction(custom, event, 'other')).toBeNull()
    expect(resolveAction(DEFAULT_BINDINGS, event, 'mac')).toBeNull()
    expect(resolveAction(DEFAULT_BINDINGS, event, 'other')).toBe('palette')
    expect(resolveAction(custom, ev('p', { ctrlKey: true }), 'mac')).toBe('palette')
  })
})

describe('findConflicts', () => {
  it('reports a combo bound to two actions, with its display text', () => {
    expect(findConflicts(rebind({ lap: ['l', 'r'] }), 'other')).toEqual([
      { combo: 'R', actions: ['reset', 'lap'] },
    ])
  })

  it('reports conflicts that exist on one platform only', () => {
    const bound = rebind({ help: ['Ctrl+K'] })
    expect(findConflicts(bound, 'other')).toEqual([
      { combo: 'Ctrl+K', actions: ['palette', 'help'] },
    ])
    expect(findConflicts(bound, 'mac')).toEqual([])
  })

  it('treats ? and Shift+? as one combo', () => {
    expect(findConflicts(rebind({ mute: ['Shift+?'] }), 'mac')).toEqual([
      { combo: '⇧?', actions: ['mute', 'help'] },
    ])
  })

  it('keeps letters with and without Shift apart', () => {
    expect(findConflicts(rebind({ lap: ['Shift+R'] }), 'other')).toEqual([])
  })

  it('does not count an action listing one combo twice', () => {
    expect(findConflicts(rebind({ reset: ['r', 'R', ' r '] }), 'other')).toEqual([])
  })

  it('lists every action sharing a combo, and every conflicting combo', () => {
    const bound = rebind({ lap: ['r'], mute: ['r'], presets: ['Mod+K'] })
    expect(findConflicts(bound, 'mac')).toEqual([
      { combo: 'R', actions: ['reset', 'lap', 'mute'] },
      { combo: '⌘K', actions: ['presets', 'palette'] },
    ])
  })

  it('ignores malformed text and returns nothing for non-bindings', () => {
    expect(findConflicts(rebind({ lap: ['Hyper+R'] }), 'other')).toEqual([])
    expect(findConflicts(undefined as unknown as Bindings, 'other')).toEqual([])
  })
})

describe('isDigitKey', () => {
  it('accepts the ten ASCII digits', () => {
    for (let d = 0; d <= 9; d++) expect(isDigitKey(String(d))).toBe(true)
  })

  it('rejects everything else', () => {
    for (const key of ['a', '10', '', ' ', '١', '５', 'Numpad5', 'Digit5', '-1', '.']) {
      expect(isDigitKey(key)).toBe(false)
    }
    for (const junk of [5, null, undefined])
      expect(isDigitKey(junk as unknown as string)).toBe(false)
  })
})
