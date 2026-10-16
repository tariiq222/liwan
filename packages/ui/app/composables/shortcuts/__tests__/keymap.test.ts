import { describe, expect, it } from 'vitest'
import { IDLE_SHORTCUTS, isApplePlatform, matchShortcut, shortcutKey, type ShortcutKeyEvent } from '../keymap'

const body = { tagName: 'BODY', closest: () => null }
const ev = (patch: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: 'c', code: 'KeyC', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 67, defaultPrevented: false, target: body, ...patch,
})
const ready = { hydrated: true, overlayOpen: false, paletteOpen: false, now: 10_000 }

describe('shortcutKey: the Latin character, else the US physical position', () => {
  it.each([
    ['p', 'KeyP', 'p'], ['P', 'KeyP', 'p'],
    ['ح', 'KeyP', 'p'], ['ن', 'KeyK', 'k'], ['ل', 'KeyG', 'g'], // Arabic (101)
    ['[', 'BracketLeft', '['], ['ج', 'BracketLeft', '['], // US, Arabic
    ['ü', 'BracketLeft', '['], ['Dead', 'BracketLeft', '['], // QWERTZ, AZERTY dead key
    ['[', 'Minus', '['], ['/', 'BracketLeft', '/'], // Dvorak: the character wins
    ['m', 'Semicolon', 'm'], [',', 'KeyM', null], // AZERTY: labels win
    ['ظ', 'Slash', '/'], ['?', 'Slash', '?'], ['؟', 'Slash', '?'],
    ['1', 'Digit1', '1'], ['١', 'Digit1', '1'],
    ['Escape', 'Escape', null], ['Enter', 'Enter', null], [' ', 'Space', null], ['Shift', 'ShiftLeft', null],
  ] as const)('%s on %s is %s', (key, code, expected) => {
    expect(shortcutKey({ key, code, shiftKey: key === '?' || key === '؟' })).toBe(expected)
  })
})

describe('matchShortcut: ⌘K / Ctrl K', () => {
  it.each([
    ['⌘K', { key: 'k', code: 'KeyK', metaKey: true }],
    ['Ctrl K', { key: 'k', code: 'KeyK', ctrlKey: true }],
    ['Ctrl K on an Arabic layout', { key: 'ن', code: 'KeyK', ctrlKey: true }],
    ['⌘K inside a field', { key: 'k', code: 'KeyK', metaKey: true, target: { tagName: 'INPUT' } }],
  ] as const)('%s opens the palette', (_label, patch) => {
    expect(matchShortcut(ev(patch), ready, IDLE_SHORTCUTS).action).toEqual({ kind: 'palette' })
  })

  it('toggles while the palette itself is open', () => {
    expect(matchShortcut(ev({ key: 'k', code: 'KeyK', metaKey: true }), { ...ready, overlayOpen: true, paletteOpen: true }, IDLE_SHORTCUTS).action)
      .toEqual({ kind: 'palette' })
  })

  it('does not open over another overlay (unsaved-changes modal, menu, select)', () => {
    expect(matchShortcut(ev({ key: 'k', code: 'KeyK', metaKey: true }), { ...ready, overlayOpen: true, paletteOpen: false }, IDLE_SHORTCUTS).action)
      .toBeNull()
  })

  it.each([
    ['before hydration', { key: 'k', code: 'KeyK', metaKey: true }, { hydrated: false }],
    ['with Shift', { key: 'K', code: 'KeyK', metaKey: true, shiftKey: true }, {}],
    ['with Alt', { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }, {}],
    ['while composing', { key: 'k', code: 'KeyK', ctrlKey: true, isComposing: true }, {}],
  ] as const)('does nothing %s', (_label, patch, context) => {
    expect(matchShortcut(ev(patch), { ...ready, ...context }, IDLE_SHORTCUTS).action).toBeNull()
  })
})

describe('matchShortcut: plain keys', () => {
  it.each([
    ['/', { key: '/', code: 'Slash' }, { kind: 'focus-search' }],
    ['/ on Arabic («ظ»)', { key: 'ظ', code: 'Slash' }, { kind: 'focus-search' }],
    ['/ on QWERTZ (Shift+7)', { key: '/', code: 'Digit7', shiftKey: true }, { kind: 'focus-search' }],
    ['? (Shift+/)', { key: '?', code: 'Slash', shiftKey: true }, { kind: 'help' }],
    ['? on Arabic («؟»)', { key: '؟', code: 'Slash', shiftKey: true }, { kind: 'help' }],
    ['? on AZERTY (Shift+,)', { key: '?', code: 'KeyM', shiftKey: true }, { kind: 'help' }],
    ['C', { key: 'c', code: 'KeyC' }, { kind: 'create' }],
    ['C on Arabic («ؤ»)', { key: 'ؤ', code: 'KeyC' }, { kind: 'create' }],
    ['G', { key: 'g', code: 'KeyG' }, { kind: 'chord' }],
  ] as const)('%s', (_label, patch, action) => {
    expect(matchShortcut(ev(patch), ready, IDLE_SHORTCUTS).action).toEqual(action)
  })

  it.each([
    ['typing in an input', { target: { tagName: 'INPUT' } }],
    ['typing in a textarea', { target: { tagName: 'TEXTAREA' } }],
    ['choosing in a select', { target: { tagName: 'SELECT' } }],
    ['typing in rich text', { target: { tagName: 'DIV', isContentEditable: true } }],
    ['inside contenteditable=""', { target: { tagName: 'SPAN', closest: (s: string) => (s.includes('contenteditable') ? {} : null) } }],
    ['typing Arabic in an input', { key: 'ؤ', target: { tagName: 'INPUT' } }],
    ['Ctrl', { ctrlKey: true }],
    ['⌘', { metaKey: true }],
    ['Alt', { altKey: true }],
    ['Shift (capital C)', { key: 'C', shiftKey: true }],
    ['auto-repeat', { repeat: true }],
    ['IME composition', { isComposing: true }],
    ['IME keyCode 229', { keyCode: 229 }],
    ['an already handled key', { defaultPrevented: true }],
    ['a closed Select trigger (typeahead)', { target: { tagName: 'BUTTON', closest: (s: string) => (s.includes('combobox') ? {} : null) } }],
    ['an open listbox option', { target: { tagName: 'DIV', closest: (s: string) => (s.includes('listbox') ? {} : null) } }],
    ['a tree', { target: { tagName: 'LI', closest: (s: string) => (s.includes('"tree"') ? {} : null) } }],
    ['a grid cell', { target: { tagName: 'TD', closest: (s: string) => (s.includes('"grid"') ? {} : null) } }],
  ] as const)('C does nothing when %s', (_label, patch) => {
    expect(matchShortcut(ev(patch), ready, IDLE_SHORTCUTS).action).toBeNull()
  })

  it('nothing plain fires before hydration or while a menu or dialog is open', () => {
    for (const context of [{ ...ready, hydrated: false }, { ...ready, overlayOpen: true }]) {
      for (const patch of [{}, { key: 'g', code: 'KeyG' }, { key: '/', code: 'Slash' }, { key: '?', code: 'Slash', shiftKey: true }]) {
        expect(matchShortcut(ev(patch), context, IDLE_SHORTCUTS).action).toBeNull()
      }
    }
  })
})

describe('matchShortcut: G then a letter', () => {
  it('a letter within a second is a go-to, by label or by position', () => {
    const first = matchShortcut(ev({ key: 'g', code: 'KeyG' }), ready, IDLE_SHORTCUTS)
    expect(first).toEqual({ action: { kind: 'chord' }, state: { goSince: 10_000 } })
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP' }), { ...ready, now: 10_900 }, first.state))
      .toEqual({ action: { kind: 'go', key: 'p' }, state: IDLE_SHORTCUTS })
    const arabic = matchShortcut(ev({ key: 'ل', code: 'KeyG' }), ready, IDLE_SHORTCUTS)
    expect(matchShortcut(ev({ key: 'ف', code: 'KeyT' }), ready, arabic.state).action).toEqual({ kind: 'go', key: 't' })
  })

  it('the letter after G is a destination, not the C shortcut', () => {
    expect(matchShortcut(ev(), ready, { goSince: 10_000 }).action).toEqual({ kind: 'go', key: 'c' })
  })

  it('a late, modified, typed or non-letter key ends the chord without acting', () => {
    const pending = { goSince: 10_000 }
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP' }), { ...ready, now: 11_001 }, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
    expect(matchShortcut(ev({ key: 'Escape', code: 'Escape' }), ready, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP', ctrlKey: true }), ready, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
    expect(matchShortcut(ev({ key: 'p', code: 'KeyP', target: { tagName: 'INPUT' } }), ready, pending)).toEqual({ action: null, state: IDLE_SHORTCUTS })
  })

  it('a bare modifier press keeps the chord pending', () => {
    const pending = { goSince: 10_000 }
    expect(matchShortcut(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), ready, pending)).toEqual({ action: null, state: pending })
  })
})

describe('isApplePlatform', () => {
  it.each([
    [{ platform: 'MacIntel' }, true],
    [{ platform: '', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, true],
    [{ platform: 'Win32' }, false],
    [{ platform: 'Linux x86_64' }, false],
  ])('%o → %s', (nav, expected) => {
    expect(isApplePlatform(nav)).toBe(expected)
  })
})
