import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { keymap, settings } from '../../core'
import {
  HIDDEN_ACTIONS,
  SHORTCUT_GROUPS,
  boundKeys,
  classifyRecording,
  comboText,
  hasCustomizations,
  isCustomized,
  sameCombo,
  sharedShortcuts,
  withDefaultShortcut,
  withShortcut,
  withoutShortcut,
} from './rebinding'

const PLATFORMS: readonly keymap.Platform[] = ['mac', 'other']

function combo(key: string, mods: Partial<Omit<keymap.KeyCombo, 'key'>> = {}): keymap.KeyCombo {
  return { key, ctrl: false, alt: false, shift: false, meta: false, ...mods }
}

const bindings = (overrides: settings.KeymapOverrides = {}) => settings.bindingsWith(overrides)

describe('SHORTCUT_GROUPS', () => {
  it('lists every action exactly once, except the hidden mini window', () => {
    const listed = SHORTCUT_GROUPS.flatMap((group) => group.actions)
    expect(new Set(listed).size).toBe(listed.length)
    expect([...listed].sort()).toEqual(
      keymap.ACTION_IDS.filter((action) => !HIDDEN_ACTIONS.includes(action)).sort(),
    )
    expect(HIDDEN_ACTIONS).toEqual(['miniWindow'])
  })

  it('gives every group a title', () => {
    for (const group of SHORTCUT_GROUPS) expect(group.title()).not.toBe('')
  })

  it('lists the settings shortcut under App', () => {
    const app = SHORTCUT_GROUPS.find((group) => group.actions.includes('palette'))
    expect(app?.actions).toContain('settings')
  })
})

describe('comboText', () => {
  it('writes the command modifier as Mod on each platform', () => {
    expect(comboText(combo(',', { ctrl: true }), 'other')).toBe('Mod+,')
    expect(comboText(combo(',', { meta: true }), 'mac')).toBe('Mod+,')
    expect(comboText(combo('k', { meta: true, shift: true }), 'mac')).toBe('Mod+Shift+k')
  })

  it('keeps the other platform modifiers by name', () => {
    expect(comboText(combo('k', { ctrl: true }), 'mac')).toBe('Ctrl+k')
    expect(comboText(combo('k', { meta: true }), 'other')).toBe('Meta+k')
    expect(comboText(combo('ArrowLeft', { alt: true }), 'other')).toBe('Alt+ArrowLeft')
  })

  it('names the space bar and keeps the plus key parsable', () => {
    expect(comboText(combo(' '), 'other')).toBe('Space')
    expect(comboText(combo('+', { ctrl: true }), 'other')).toBe('Mod++')
    expect(keymap.parseCombo('Mod++', 'other')).toEqual(combo('+', { ctrl: true }))
  })

  it('reads back to the same combo on the same platform', () => {
    const keys = fc.constantFrom(
      'a',
      'z',
      ',',
      '.',
      '/',
      '?',
      '+',
      '-',
      ' ',
      'Enter',
      'Escape',
      'Delete',
      'Tab',
      'F2',
      'F12',
      'ArrowUp',
      'Home',
      'é',
      'ß',
    )
    fc.assert(
      fc.property(
        keys,
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(...PLATFORMS),
        (key, ctrl, alt, shift, meta, platform) => {
          const pressed = keymap.comboFromEvent({
            key,
            ctrlKey: ctrl,
            altKey: alt,
            shiftKey: shift,
            metaKey: meta,
          })
          const back = keymap.parseCombo(comboText(pressed, platform), platform)
          expect(back).toEqual(pressed)
        },
      ),
    )
  })
})

describe('sameCombo', () => {
  it('matches combos that match the same presses', () => {
    expect(sameCombo(combo('?'), combo('?', { shift: true }))).toBe(true)
    expect(sameCombo(combo('n'), combo('n', { shift: true }))).toBe(false)
    expect(sameCombo(combo('k', { ctrl: true }), combo('k', { meta: true }))).toBe(false)
    expect(sameCombo(combo('Escape'), combo('Escape'))).toBe(true)
  })
})

describe('boundKeys', () => {
  it('lists the labels of each combo in binding order', () => {
    expect(boundKeys(bindings(), 'palette', 'other')).toEqual([{ text: 'Mod+K', label: 'Ctrl+K' }])
    expect(boundKeys(bindings(), 'palette', 'mac')).toEqual([{ text: 'Mod+K', label: '⌘K' }])
    expect(boundKeys(bindings(), 'dismiss', 'other')).toEqual([])
  })

  it('skips text that does not parse and repeats of the same combo', () => {
    const custom = { ...keymap.DEFAULT_BINDINGS, palette: ['Mod+K', 'Ctrl+K', 'Nope+K', 'Mod+P'] }
    expect(boundKeys(custom, 'palette', 'other').map((key) => key.label)).toEqual([
      'Ctrl+K',
      'Ctrl+P',
    ])
    const broken = { ...keymap.DEFAULT_BINDINGS, palette: 'Mod+K' } as unknown as keymap.Bindings
    expect(boundKeys(broken, 'palette', 'other')).toEqual([])
  })
})

describe('classifyRecording', () => {
  it('refuses digits, Backspace, bare modifiers and unknown keys', () => {
    for (const pressed of [
      combo('5'),
      combo('5', { shift: true }),
      combo('Backspace'),
      combo('Shift', { shift: true }),
      combo('Control', { ctrl: true }),
      combo('Unidentified'),
      combo('Dead'),
      combo('Process'),
      combo(''),
    ]) {
      expect(classifyRecording(bindings(), 'newTimer', pressed, 'other').kind).toBe('reserved')
    }
  })

  it('refuses a key the keymap cannot store', () => {
    const result = classifyRecording(bindings(), 'newTimer', combo('ab'), 'other')
    expect(result).toEqual({ kind: 'reserved', label: 'ab' })
    const long = combo(`F${'x'.repeat(70)}`)
    expect(classifyRecording(bindings(), 'newTimer', long, 'other').kind).toBe('reserved')
  })

  it('allows digits and Backspace with Ctrl, Alt or Meta', () => {
    const result = classifyRecording(bindings(), 'newTimer', combo('5', { alt: true }), 'other')
    expect(result).toEqual({ kind: 'free', label: 'Alt+5', text: 'Alt+5', moveFrom: [] })
  })

  it('reports the actions that already use a key', () => {
    const result = classifyRecording(bindings(), 'newTimer', combo('k', { ctrl: true }), 'other')
    expect(result).toEqual({
      kind: 'conflict',
      label: 'Ctrl+K',
      text: 'Mod+k',
      owners: ['palette'],
      moveFrom: ['palette'],
    })
  })

  it('treats ? and Shift+? as the same key, recorded and shown without Shift', () => {
    const result = classifyRecording(bindings(), 'rename', combo('?', { shift: true }), 'other')
    expect(result).toMatchObject({ kind: 'conflict', label: '?', text: '?', owners: ['help'] })
    const free = classifyRecording(bindings(), 'rename', combo('+', { shift: true }), 'mac')
    expect(free).toEqual({ kind: 'free', label: '+', text: '+', moveFrom: [] })
    // Letters keep their Shift.
    const letter = classifyRecording(bindings(), 'rename', combo('t', { shift: true }), 'other')
    expect(letter).toMatchObject({ kind: 'free', label: 'Shift+T', text: 'Shift+t' })
  })

  it('treats a key only a hidden action uses as free, and moves it from that action', () => {
    const result = classifyRecording(bindings(), 'newTimer', combo('t'), 'other')
    expect(result).toEqual({ kind: 'free', label: 'T', text: 't', moveFrom: ['miniWindow'] })
    const next = withShortcut({}, 'newTimer', 't', 'other', ['miniWindow'])
    expect(next).toEqual({ newTimer: ['t'], miniWindow: [] })
    expect(keymap.findConflicts(settings.bindingsWith(next), 'other')).toEqual([])
  })

  it('names only listed actions in a conflict, and moves the key from hidden ones too', () => {
    const shared = bindings({ lap: ['t'] })
    const result = classifyRecording(shared, 'newTimer', combo('t'), 'other')
    expect(result).toMatchObject({ owners: ['lap'], moveFrom: ['lap', 'miniWindow'] })
  })

  it('treats the action’s own key as free', () => {
    const result = classifyRecording(bindings(), 'palette', combo('k', { meta: true }), 'mac')
    expect(result).toEqual({ kind: 'free', label: '⌘K', text: 'Mod+k', moveFrom: [] })
  })

  it('lists every owner of a key bound twice', () => {
    const doubled = bindings({ lap: ['e'] })
    const result = classifyRecording(doubled, 'newTimer', combo('e'), 'other')
    expect(result.kind === 'conflict' && result.owners).toEqual(['lap', 'editMode'])
  })
})

describe('withShortcut', () => {
  it('binds the action to the key alone', () => {
    const next = withShortcut({}, 'newTimer', 'Shift+t', 'other')
    expect(next).toEqual({ newTimer: ['Shift+t'] })
    expect(Object.isFrozen(next)).toBe(true)
    expect(settings.bindingsWith(next).newTimer).toEqual(['Shift+t'])
  })

  it('drops the override when the key is the default again', () => {
    expect(withShortcut({ palette: ['Mod+p'] }, 'palette', 'Mod+k', 'other')).toEqual({})
    expect(withShortcut({}, 'newTimer', 'N', 'mac')).toEqual({})
  })

  it('moves the key away from its owners', () => {
    const next = withShortcut({}, 'newStopwatch', 'Mod+k', 'other', ['palette'])
    expect(next).toEqual({ newStopwatch: ['Mod+k'], palette: [] })
    const bound = settings.bindingsWith(next)
    expect(keymap.findConflicts(bound, 'other')).toEqual([])
  })

  it('keeps an owner’s other keys and drops the override once they are the defaults', () => {
    const start = { palette: ['Mod+K', 'Mod+P'] }
    const moved = withShortcut(start, 'newTimer', 'Mod+p', 'other', ['palette'])
    expect(moved).toEqual({ newTimer: ['Mod+p'] })
  })

  it('ignores the action itself among the owners', () => {
    expect(withShortcut({}, 'newTimer', 'Shift+t', 'other', ['newTimer'])).toEqual({
      newTimer: ['Shift+t'],
    })
  })
})

describe('withoutShortcut', () => {
  it('removes one key, leaving the action unbound when it was the only one', () => {
    expect(withoutShortcut({}, 'palette', 'Mod+K', 'other')).toEqual({ palette: [] })
  })

  it('removes every spelling of the same combo', () => {
    const start = { palette: ['Mod+K', 'Ctrl+K', 'Mod+P'] }
    expect(withoutShortcut(start, 'palette', 'Ctrl+K', 'other')).toEqual({ palette: ['Mod+P'] })
  })

  it('drops the override when what is left is the default', () => {
    expect(withoutShortcut({ palette: ['Mod+K', 'Mod+P'] }, 'palette', 'Mod+P', 'other')).toEqual(
      {},
    )
  })
})

describe('withDefaultShortcut and customization', () => {
  it('gives an action its default back', () => {
    const start = { palette: ['Mod+P'], lap: ['x'] }
    expect(withDefaultShortcut(start, 'palette')).toEqual({ lap: ['x'] })
    const none = {}
    expect(withDefaultShortcut(none, 'palette')).toBe(none)
  })

  it('tells which actions differ from their defaults', () => {
    const overrides = { palette: ['Ctrl+K'], lap: ['x'] }
    expect(isCustomized(overrides, 'palette', 'other')).toBe(false)
    expect(isCustomized(overrides, 'palette', 'mac')).toBe(true)
    expect(isCustomized(overrides, 'lap', 'other')).toBe(true)
    expect(isCustomized(overrides, 'reset', 'other')).toBe(false)
    expect(hasCustomizations({}, 'other')).toBe(false)
    expect(hasCustomizations({ palette: ['Ctrl+K'] }, 'other')).toBe(false)
    expect(hasCustomizations(overrides, 'other')).toBe(true)
  })
})

describe('sharedShortcuts', () => {
  it('finds nothing in the defaults', () => {
    expect(sharedShortcuts(bindings(), 'other').size).toBe(0)
    expect(sharedShortcuts(bindings(), 'mac').size).toBe(0)
  })

  it('lists, for each action, the combos other actions use too', () => {
    // From an import: Ctrl+K for a new timer as well as for the palette.
    const shared = sharedShortcuts(bindings({ newTimer: ['Mod+K'] }), 'other')
    expect(shared.get('newTimer')).toEqual([{ label: 'Ctrl+K', others: ['palette'] }])
    expect(shared.get('palette')).toEqual([{ label: 'Ctrl+K', others: ['newTimer'] }])
    expect(shared.size).toBe(2)
  })

  it('finds a combo recorded on a Mac that is another action’s key elsewhere', () => {
    const fromMac = bindings({ newStopwatch: ['Ctrl+k'] })
    expect(sharedShortcuts(fromMac, 'mac').size).toBe(0)
    expect(sharedShortcuts(fromMac, 'other').get('newStopwatch')).toEqual([
      { label: 'Ctrl+K', others: ['palette'] },
    ])
  })

  it('leaves out hidden actions', () => {
    expect(sharedShortcuts(bindings({ newTimer: ['t'] }), 'other').size).toBe(0)
  })
})
