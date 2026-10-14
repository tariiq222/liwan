import { describe, expect, it } from 'vitest'
import type { ShortcutKeyEvent } from '../keymap'
import { navigableRows, nextRowIndex, rowMove } from '../rows'

const ev = (patch: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  key: 'j', code: 'KeyJ', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false,
  repeat: false, isComposing: false, keyCode: 74, defaultPrevented: false, target: { tagName: 'BODY', closest: () => null }, ...patch,
})
const ready = { hydrated: true, overlayOpen: false }

describe('rowMove', () => {
  it.each([
    [{ key: 'j', code: 'KeyJ' }, 'j'], [{ key: 'k', code: 'KeyK' }, 'k'],
    [{ key: 'ت', code: 'KeyJ' }, 'j'], [{ key: 'ن', code: 'KeyK' }, 'k'],
  ] as const)('%o moves %s', (patch, move) => {
    expect(rowMove(ev(patch), ready)).toBe(move)
  })

  it.each([
    ['Shift', { key: 'J', shiftKey: true }],
    ['typing', { target: { tagName: 'INPUT' } }],
    ['Ctrl', { ctrlKey: true }],
    ['composition', { isComposing: true }],
    ['another key', { key: 'x', code: 'KeyX' }],
  ] as const)('ignores %s', (_label, patch) => {
    expect(rowMove(ev(patch), ready)).toBeNull()
  })

  it('still moves from a row that lives inside a grid, but not from a plain grid cell', () => {
    const closest = (rowMarked: boolean) => (s: string) => {
      if (s.includes('"grid"')) return {}
      if (s.includes('data-shortcut-row')) return rowMarked ? {} : null
      return null
    }
    expect(rowMove(ev({ target: { tagName: 'TR', closest: closest(true) } }), ready)).toBe('j')
    expect(rowMove(ev({ target: { tagName: 'TD', closest: closest(false) } }), ready)).toBeNull()
  })

  it('ignores keys while a menu is open or before hydration', () => {
    expect(rowMove(ev(), { hydrated: true, overlayOpen: true })).toBeNull()
    expect(rowMove(ev(), { hydrated: false, overlayOpen: false })).toBeNull()
  })
})

describe('nextRowIndex', () => {
  it.each([
    [-1, 3, 'j', 0], [-1, 3, 'k', 2], [0, 3, 'j', 1], [2, 3, 'j', 2], [1, 3, 'k', 0], [0, 3, 'k', 0], [-1, 0, 'j', -1],
  ] as const)('from %i of %i, %s goes to %i', (current, count, move, expected) => {
    expect(nextRowIndex(current, count, move)).toBe(expected)
  })
})

describe('which rows J and K reach', () => {
  const row = (name: string, patch: { rects?: number; inside?: string } = {}) => ({
    name,
    getClientRects: () => ({ length: patch.rects ?? 1 }),
    closest: (selectors: string) => (patch.inside && selectors.split(',').map(part => part.trim()).includes(patch.inside) ? {} : null),
  })

  it('navigableRows skips hidden and inert rows', () => {
    const rows = [
      row('desktop row under display:none', { rects: 0 }),
      row('a'),
      row('inert', { inside: '[inert]' }),
      row('aria-hidden', { inside: '[aria-hidden="true"]' }),
      row('b'),
    ]
    expect(navigableRows(rows).map(entry => entry.name)).toEqual(['a', 'b'])
  })

  it('returns nothing when every row is hidden', () => {
    expect(navigableRows([row('x', { rects: 0 })])).toEqual([])
  })
})
