import { describe, expect, it } from 'vitest'
import { isSidebarToggleShortcut, type SidebarShortcutEvent } from '../sidebarShortcut'

const press: SidebarShortcutEvent = {
  key: '[', code: 'BracketLeft', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 219, defaultPrevented: false, target: { tagName: 'BODY' },
}

describe('[ toggles the context sidebar', () => {
  it.each([
    ['US «[»', { key: '[', code: 'BracketLeft' }],
    ['Arabic «ج» on the same key', { key: 'ج', code: 'BracketLeft' }],
    ['QWERTZ «ü» on the same key', { key: 'ü', code: 'BracketLeft' }],
    ['AZERTY ^ dead key on the same key', { key: 'Dead', code: 'BracketLeft' }],
    ['Dvorak «[» on another key', { key: '[', code: 'Minus' }],
  ] as const)('matches %s', (_label, patch) => {
    expect(isSidebarToggleShortcut({ ...press, ...patch }, false)).toBe(true)
  })

  it.each([
    ['another key', { key: ']', code: 'BracketRight' }],
    ['Dvorak «/» typed on the BracketLeft key', { key: '/', code: 'BracketLeft' }],
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }],
    ['auto-repeat', { repeat: true }],
    ['IME composition', { isComposing: true }],
    ['IME keyCode 229', { keyCode: 229 }],
    ['an already handled key', { defaultPrevented: true }],
    ['typing in an input', { target: { tagName: 'INPUT' } }],
    ['typing in a textarea', { target: { tagName: 'TEXTAREA' } }],
    ['typing in rich text', { target: { tagName: 'DIV', isContentEditable: true } }],
  ] as const)('ignores %s', (_label, patch) => {
    expect(isSidebarToggleShortcut({ ...press, ...patch }, false)).toBe(false)
  })

  it('ignores the key while a menu or dialog owns the keyboard', () => {
    expect(isSidebarToggleShortcut(press, true)).toBe(false)
  })
})
