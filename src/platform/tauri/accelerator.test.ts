import { describe, expect, it } from 'vitest'

import { errorText, registerFailure, toAccelerator } from './accelerator'

describe('toAccelerator', () => {
  it('turns Mod into CommandOrControl, so the plugin picks Cmd on macOS and Ctrl elsewhere', () => {
    expect(toAccelerator('Mod+Shift+Space')).toBe('CommandOrControl+Shift+Space')
    expect(toAccelerator('Mod+K')).toBe('CommandOrControl+KeyK')
    expect(toAccelerator('mod+alt+t')).toBe('CommandOrControl+Alt+KeyT')
  })

  it('keeps explicit modifiers, Meta as Super, in a fixed order with the key last', () => {
    expect(toAccelerator('Ctrl+Alt+Shift+P')).toBe('Control+Alt+Shift+KeyP')
    expect(toAccelerator('Shift+Ctrl+P')).toBe('Control+Shift+KeyP')
    expect(toAccelerator('Meta+Shift+1')).toBe('Super+Shift+Digit1')
    expect(toAccelerator('Win+E')).toBe('Super+KeyE')
    expect(toAccelerator('Cmd+Option+Up')).toBe('Super+Alt+ArrowUp')
    expect(toAccelerator('Mod+Ctrl+K')).toBe('CommandOrControl+Control+KeyK')
    expect(toAccelerator('Mod+Meta+K')).toBe('CommandOrControl+Super+KeyK')
  })

  it('reads the macOS display form', () => {
    expect(toAccelerator('⌃⌥⇧⌘K')).toBe('Control+Super+Alt+Shift+KeyK')
  })

  it('names keys by their physical key code', () => {
    const cases: [string, string][] = [
      ['Ctrl+A', 'Control+KeyA'],
      ['Ctrl+z', 'Control+KeyZ'],
      ['Ctrl+0', 'Control+Digit0'],
      ['Ctrl+9', 'Control+Digit9'],
      ['Ctrl+Space', 'Control+Space'],
      ['Ctrl+`', 'Control+Backquote'],
      ['Ctrl+\\', 'Control+Backslash'],
      ['Ctrl+[', 'Control+BracketLeft'],
      ['Ctrl+]', 'Control+BracketRight'],
      ['Ctrl+,', 'Control+Comma'],
      ['Ctrl+=', 'Control+Equal'],
      ['Ctrl+-', 'Control+Minus'],
      ['Ctrl+.', 'Control+Period'],
      ["Ctrl+'", 'Control+Quote'],
      ['Ctrl+;', 'Control+Semicolon'],
      ['Ctrl+/', 'Control+Slash'],
      ['Ctrl+Enter', 'Control+Enter'],
      ['Ctrl+Return', 'Control+Enter'],
      ['Ctrl+Tab', 'Control+Tab'],
      ['Ctrl+Esc', 'Control+Escape'],
      ['Ctrl+Backspace', 'Control+Backspace'],
      ['Ctrl+Del', 'Control+Delete'],
      ['Ctrl+Insert', 'Control+Insert'],
      ['Ctrl+Home', 'Control+Home'],
      ['Ctrl+End', 'Control+End'],
      ['Ctrl+PageUp', 'Control+PageUp'],
      ['Ctrl+PageDown', 'Control+PageDown'],
      ['Ctrl+Left', 'Control+ArrowLeft'],
      ['Ctrl+→', 'Control+ArrowRight'],
      ['Ctrl+Down', 'Control+ArrowDown'],
      ['Ctrl+PrintScreen', 'Control+PrintScreen'],
      ['Ctrl+ScrollLock', 'Control+ScrollLock'],
      ['Ctrl+Pause', 'Control+Pause'],
      ['Ctrl+f5', 'Control+F5'],
      ['Ctrl+F24', 'Control+F24'],
      ['Ctrl+MediaPlayPause', 'Control+MediaPlayPause'],
    ]
    for (const [binding, accelerator] of cases)
      expect(toAccelerator(binding), binding).toBe(accelerator)
  })

  it('allows the function, media and volume keys alone, which type nothing', () => {
    expect(toAccelerator('F9')).toBe('F9')
    expect(toAccelerator('Shift+F13')).toBe('Shift+F13')
    expect(toAccelerator('MediaPlayPause')).toBe('MediaPlayPause')
    expect(toAccelerator('MediaTrackNext')).toBe('MediaTrackNext')
    expect(toAccelerator('AudioVolumeMute')).toBe('AudioVolumeMute')
  })

  it('refuses a typing key without Ctrl, Alt or Meta, which would stop it typing everywhere', () => {
    for (const binding of [
      'A',
      'Shift+A',
      'Space',
      'Shift+Space',
      '1',
      'Enter',
      'Esc',
      'Shift+/',
    ]) {
      expect(toAccelerator(binding), binding).toBeNull()
    }
  })

  it('refuses keys with no physical key code and text that does not parse', () => {
    for (const binding of [
      'Ctrl+?',
      'Ctrl++',
      'Ctrl+@',
      'Ctrl+é',
      'Ctrl+ContextMenu',
      'Ctrl+CapsLock',
      'Ctrl+NumLock',
      'Ctrl+F25',
      'Ctrl+',
      'Ctrl+Shift',
      'Hyper+K',
      '',
      '   ',
    ]) {
      expect(toAccelerator(binding), binding).toBeNull()
    }
  })
})

describe('registerFailure', () => {
  it('reads the OS refusing a combo in use as taken (Windows and X11, then macOS)', () => {
    expect(
      registerFailure(
        'HotKey already registered: HotKey { mods: Modifiers(CONTROL | SHIFT), key: Space, id: 1 }',
      ),
    ).toBe('taken')
    expect(registerFailure('Unable to register hotkey: RegisterEventHotKey failed for KeyK')).toBe(
      'taken',
    )
    expect(registerFailure(new Error('HotKey already registered'))).toBe('taken')
  })

  it('reads a combo the plugin cannot parse or the OS has no key for as invalid', () => {
    for (const message of [
      'Couldn\'t recognize "Foo" as a valid key for hotkey, if you feel like it should be, please report this to https://github.com/tauri-apps/muda',
      'Found empty token while parsing hotkey: Ctrl++',
      'Invalid hotkey format: "Ctrl+A+B", an hotkey should have the modifiers first and only one main key, for example: "Shift + Alt + K"',
      'Unable to register hotkey: Unknown VKCode for F24',
      'Unable to register hotkey: Unknown scancode for MediaPlay',
      'Unable to register hotkey: Unable to find keycode for key: Pause',
    ]) {
      expect(registerFailure(message), message).toBe('invalid')
    }
  })

  it('leaves every other failure to the caller', () => {
    expect(registerFailure('global-shortcut.register not allowed. Plugin not found')).toBeNull()
    expect(registerFailure(new TypeError('invoke is not a function'))).toBeNull()
    expect(registerFailure(undefined)).toBeNull()
  })
})

describe('errorText', () => {
  it('reads Tauri strings, errors and anything else', () => {
    expect(errorText('denied')).toBe('denied')
    expect(errorText(new Error('broken'))).toBe('broken')
    expect(errorText(42)).toBe('42')
  })
})
