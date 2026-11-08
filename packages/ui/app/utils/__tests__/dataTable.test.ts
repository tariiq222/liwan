import { describe, expect, it } from 'vitest'
import { applyScrollEdges, clickedRowIndex, dataRowKey, decorateColumns, markTableRoles, markTableRows, rowSelectionState, scrollEdges, selectedFromRowSelection, tableMinWidth, TABLE_BODY_ROWS } from '../dataTable'

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
    expect(clickedRowIndex(target({ '.liwan-select-cell': {}, '[data-shortcut-row]': row('0') }))).toBeNull()
    expect(clickedRowIndex(target({}))).toBeNull()
    expect(clickedRowIndex(target({ '[data-shortcut-row]': row(null) }))).toBeNull()
    expect(clickedRowIndex(null)).toBeNull()
  })
})

describe('decorateColumns', () => {
  type Meta = { class?: { th?: unknown; td?: unknown }; style?: { td?: unknown } }
  const meta = (column: unknown) => (column as { meta: Meta }).meta
  const columns = [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'manager', header: 'Manager', meta: { class: { th: 'w-24', td: 'w-24' } } },
    { accessorKey: 'total', header: 'Total', meta: { numeric: true } },
    { id: 'actions', header: 'Actions' },
  ]

  it('sticks the first data column, labels the others and ends on a sticky actions column', () => {
    const [name, manager, total, actions] = decorateColumns(columns as never, false)
    expect(meta(name).class?.td).toBe('liwan-sticky-start liwan-cell-title')
    expect(meta(name).style).toBeUndefined()
    expect(meta(manager).class?.td).toBe('w-24')
    expect(meta(manager).style?.td).toEqual({ '--liwan-label': '"Manager"' })
    expect(meta(total).class?.th).toBe('text-end tabular-nums')
    expect(meta(actions).class?.td).toBe('liwan-cell-actions liwan-sticky-end liwan-cell-actions-named')
  })

  it('sticks the select column and the column after it, and keeps a mid-table actions column unstuck', () => {
    const [select, name, actions] = decorateColumns([{ id: 'select' }, { accessorKey: 'name', header: 'Name' }, { id: 'actions', header: () => 'x' }, { accessorKey: 'last', header: 'Last' }] as never, true)
    expect(meta(select).class?.th).toBe('liwan-sticky-start liwan-cell-select')
    expect(meta(name).class?.td).toBe('liwan-sticky-start liwan-cell-title liwan-sticky-second')
    expect(meta(actions).class?.td).toBe('liwan-cell-actions')
  })

  it('treats a column flagged meta.actions as the actions column', () => {
    const [, manage] = decorateColumns([{ accessorKey: 'a', header: 'A' }, { id: 'manage', header: () => 'x', meta: { actions: true } }] as never, false)
    expect(meta(manage).class?.td).toBe('liwan-cell-actions liwan-sticky-end')
  })

  it('keeps a caller function for classes and gives no label to a column without a text header', () => {
    const [custom, plain] = decorateColumns([
      { accessorKey: 'a', header: 'A' },
      { accessorKey: 'b', header: () => 'B', meta: { class: { td: () => 'from-caller' } } },
    ] as never, false)
    expect(meta(custom).class?.td).toContain('liwan-cell-title')
    expect(meta(plain).style).toBeUndefined()
    expect(typeof meta(plain).class?.td).toBe('function')
  })

  it('escapes a header into a quoted CSS string', () => {
    const [, quoted] = decorateColumns([{ accessorKey: 'a', header: 'A' }, { accessorKey: 'b', header: 'Say "hi"  now' }] as never, false)
    expect(meta(quoted).style?.td).toEqual({ '--liwan-label': '"Say \\"hi\\" now"' })
  })
})

describe('scroll edges', () => {
  it('reads both directions from the magnitude of scrollLeft (RTL is negative)', () => {
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 800, clientWidth: 400 })).toEqual({ scrolledStart: false, canScrollEnd: true })
    expect(scrollEdges({ scrollLeft: -200, scrollWidth: 800, clientWidth: 400 })).toEqual({ scrolledStart: true, canScrollEnd: true })
    expect(scrollEdges({ scrollLeft: 400, scrollWidth: 800, clientWidth: 400 })).toEqual({ scrolledStart: true, canScrollEnd: false })
    expect(scrollEdges({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({ scrolledStart: false, canScrollEnd: false })
  })

  it('writes the two flags on the frame', () => {
    const flags: Record<string, boolean> = {}
    applyScrollEdges({ toggleAttribute: (name: string, force?: boolean) => { flags[name] = !!force; return !!force } }, { scrolledStart: true, canScrollEnd: false })
    expect(flags).toEqual({ 'data-scrolled-start': true, 'data-can-scroll-end': false })
  })
})

describe('markTableRoles', () => {
  const element = () => { const attrs: Record<string, string> = {}; return { attrs, setAttribute: (k: string, v: string) => { attrs[k] = v }, removeAttribute: (k: string) => { delete attrs[k] } } }

  it('gives a stacked table its roles back and removes them when it is a table again', () => {
    const parts: Record<string, ReturnType<typeof element>[]> = { table: [element()], 'thead, tbody': [element(), element()], 'tr:not([data-slot="separator"])': [element()], th: [element()], td: [element()], 'tr[data-slot="separator"]': [element()] }
    const root = { querySelectorAll: (selector: string) => parts[selector] ?? [] } as unknown as ParentNode
    markTableRoles(root, true)
    expect(parts.table![0]!.attrs.role).toBe('table')
    expect(parts['thead, tbody']!.map(el => el.attrs.role)).toEqual(['rowgroup', 'rowgroup'])
    expect(parts.th![0]!.attrs.role).toBe('columnheader')
    expect(parts['tr[data-slot="separator"]']![0]!.attrs.role).toBe('presentation')
    const marked = Object.values(parts).flat()
    markTableRoles({ querySelectorAll: () => marked } as unknown as ParentNode, false)
    expect(marked.every(el => !('role' in el.attrs) && !('data-stacked-role' in el.attrs))).toBe(true)
  })
})

describe('tableMinWidth', () => {
  it('adds the title floor to the other columns, using the larger of the declared minimum and the floor', () => {
    expect(tableMinWidth(760, 0, Number.NaN, 154)).toBe(914)
    expect(tableMinWidth(760, 0, 200, 154)).toBe(960)
    expect(tableMinWidth(1100, 340, 200, 154)).toBe(960)
  })
})
