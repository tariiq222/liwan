import { describe, expect, it } from 'vitest'
import { findSearchShortcut } from '../searchKeyboard'

const shortcuts = [
  { shortcut: '1', to: '/tasks' },
  { shortcut: 's', to: '/settings' },
]

describe('global search keyboard handler', () => {
  it('does not consume shortcut characters from editable targets', () => {
    const input = { tagName: 'INPUT', closest: () => null }
    const nestedEditable = { tagName: 'SPAN', closest: (selector: string) => selector.includes('contenteditable') ? nestedEditable : null }
    expect(findSearchShortcut({ key: '1', target: input }, '', shortcuts)).toBeUndefined()
    expect(findSearchShortcut({ key: 's', target: nestedEditable }, '', shortcuts)).toBeUndefined()
  })

  it('does not consume composing or modified key events', () => {
    const target = { tagName: 'BODY', closest: () => null }
    expect(findSearchShortcut({ key: '1', target, isComposing: true }, '', shortcuts)).toBeUndefined()
    expect(findSearchShortcut({ key: '1', target, ctrlKey: true }, '', shortcuts)).toBeUndefined()
    expect(findSearchShortcut({ key: '1', target, altKey: true }, '', shortcuts)).toBeUndefined()
    expect(findSearchShortcut({ key: '1', target }, 'existing', shortcuts)).toBeUndefined()
  })

  it('returns a shortcut only for an empty non-editable search context', () => {
    const target = { tagName: 'BODY', closest: () => null }
    expect(findSearchShortcut({ key: '1', target }, '', shortcuts)).toEqual(shortcuts[0])
    expect(findSearchShortcut({ key: 'x', target }, '', shortcuts)).toBeUndefined()
  })

  it('jumps while the empty field is not focused (focus rests on a link or the page body)', () => {
    const link = { tagName: 'A', closest: () => null }
    expect(findSearchShortcut({ key: '1', target: link }, '', shortcuts)).toEqual(shortcuts[0])
    expect(findSearchShortcut({ key: 's', code: 'KeyS', target: link }, '', shortcuts)).toEqual(shortcuts[1])
  })

  it('matches an Arabic layout by key position and skips keys the shell already used', () => {
    const target = { tagName: 'BODY', closest: () => null }
    expect(findSearchShortcut({ key: 'س', code: 'KeyS', target }, '', shortcuts)).toEqual(shortcuts[1])
    expect(findSearchShortcut({ key: '١', code: 'Digit1', target }, '', shortcuts)).toEqual(shortcuts[0])
    expect(findSearchShortcut({ key: 's', code: 'KeyS', target, defaultPrevented: true }, '', shortcuts)).toBeUndefined()
  })
})
