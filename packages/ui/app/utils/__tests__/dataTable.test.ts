import { describe, expect, it } from 'vitest'
import { clickedRowIndex, dataRowKey, markTableRows, rowSelectionState, selectedFromRowSelection, TABLE_BODY_ROWS } from '../dataTable'

interface Row { id: number; code: string; name: string }
const rows: Row[] = [{ id: 1, code: 'a', name: 'One' }, { id: 2, code: 'b', name: 'Two' }, { id: 3, code: 'c', name: 'Three' }]

describe('dataRowKey', () => {
  it('reads a field or calls a function', () => {
    expect(dataRowKey(rows[0]!, 'id')).toBe(1)
    expect(dataRowKey(rows[0]!, row => `p-${row.code}`)).toBe('p-a')
  })

  it('refuses a key that is not a string or a number', () => {
    expect(() => dataRowKey({ id: { nested: true } }, 'id')).toThrow(TypeError)
  })
})

describe('selection mapping', () => {
  it('builds the UTable row selection from the selected keys', () => {
    expect(rowSelectionState([1, 'b'])).toEqual({ 1: true, b: true })
    expect(rowSelectionState([])).toEqual({})
  })

  it('keeps keys from other pages and follows the table for this page, keeping the key type', () => {
    expect(selectedFromRowSelection({ 2: true, 3: true, 1: false }, rows, 'id', [9, 1])).toEqual([9, 2, 3])
    expect(selectedFromRowSelection({}, rows, 'id', [9, 1])).toEqual([9])
  })
})

describe('markTableRows', () => {
  function tr(tabindex?: string) {
    const attributes = new Map<string, string>(tabindex === undefined ? [] : [['tabindex', tabindex]])
    return {
      attributes,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      hasAttribute: (name: string) => attributes.has(name),
    }
  }

  it('marks every body row for J / K, numbers it, and makes it focusable without stealing a tab stop', () => {
    const plain = tr()
    const focusable = tr('0')
    let asked = ''
    markTableRows({ querySelectorAll: (selectors: string) => { asked = selectors; return [plain, focusable] } } as unknown as ParentNode)
    expect(asked).toBe(TABLE_BODY_ROWS)
    expect(Object.fromEntries(plain.attributes)).toEqual({ 'data-shortcut-row': '', 'data-row-index': '0', tabindex: '-1' })
    expect(focusable.attributes.get('tabindex')).toBe('0')
    expect(focusable.attributes.get('data-row-index')).toBe('1')
  })
})

describe('clickedRowIndex', () => {
  const target = (inside: Record<string, unknown>) => ({
    closest: (selectors: string) => Object.entries(inside).find(([key]) => selectors.split(',').map(part => part.trim()).includes(key))?.[1] ?? null,
  })
  const row = (index: string | null) => ({ getAttribute: (name: string) => (name === 'data-row-index' ? index : null) })

  it('returns the row a background click landed on', () => {
    expect(clickedRowIndex(target({ '[data-shortcut-row]': row('2') }))).toBe(2)
  })

  it('ignores clicks on a control inside the row, outside any row, or on an unnumbered row', () => {
    expect(clickedRowIndex(target({ a: {}, '[data-shortcut-row]': row('2') }))).toBeNull()
    expect(clickedRowIndex(target({ '[role="checkbox"]': {}, '[data-shortcut-row]': row('0') }))).toBeNull()
    expect(clickedRowIndex(target({ '.webvue-select-cell': {}, '[data-shortcut-row]': row('0') }))).toBeNull()
    expect(clickedRowIndex(target({}))).toBeNull()
    expect(clickedRowIndex(target({ '[data-shortcut-row]': row(null) }))).toBeNull()
    expect(clickedRowIndex(null)).toBeNull()
  })
})
