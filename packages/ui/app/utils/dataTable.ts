import { h, type VNode } from 'vue'
import type { TableColumn } from '@nuxt/ui'
// Relative import: this module is unit-tested directly under plain vitest.
import { ROW_SELECTOR } from '../composables/shortcuts/keymap'

/** A server-side sort: `column` is the server's key for the column (see SharedDataTable's `sortKeys`). */
export interface TableSort { column: string; direction: 'asc' | 'desc' }
export type SortDirection = TableSort['direction'] | null

/** Click order of a sortable header: ascending, descending, then none. */
export function nextSortDirection(current: SortDirection): SortDirection {
  return current === null ? 'asc' : current === 'asc' ? 'desc' : null
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const

/**
 * Sets `aria-sort` on the header cells (UTable renders no such attribute): `states` is one entry per header cell,
 * `undefined` for a column that is not sortable, which gets no attribute.
 */
export function markSortHeaders(root: ParentNode, states: readonly (SortDirection | undefined)[]): void {
  const cells = Array.from(root.querySelectorAll<HTMLElement>('thead th'))
  states.forEach((state, index) => {
    const cell = cells[index]
    if (!cell) return
    if (state === undefined) cell.removeAttribute('aria-sort')
    else cell.setAttribute('aria-sort', state === null ? 'none' : ARIA_SORT[state])
  })
}

/** What a column's `header` renders to: a string or a render function of the header context. */
export function headerContent(column: { columnDef: { header?: unknown } }, context: unknown): VNode {
  const header = column.columnDef.header
  const content = typeof header === 'function' ? (header as (ctx: unknown) => unknown)(context) : header
  return typeof content === 'string' ? h('span', content) : (content as VNode | undefined) ?? h('span')
}

/** How SharedDataTable names a row: a field holding its id, or a function of the row. */
export type RowKey<T> = keyof T | ((row: T) => string | number)

export function dataRowKey<T>(row: T, key: RowKey<T>): string | number {
  const value = typeof key === 'function' ? key(row) : row[key]
  if (typeof value === 'string' || typeof value === 'number') return value
  throw new TypeError(`DataTable rowKey must give a string or a number, got ${typeof value}`)
}

/** UTable's row selection (row ids as strings, Table.vue:135) for the selected keys. */
export function rowSelectionState(selected: readonly (string | number)[]): Record<string, boolean> {
  return Object.fromEntries(selected.map(key => [String(key), true]))
}

/**
 * The selected keys after UTable changed its row selection. Keys selected on other pages stay
 * selected; this page's rows follow the table, in row order, with their original key type.
 */
export function selectedFromRowSelection<T>(
  state: Record<string, boolean>,
  rows: readonly T[],
  key: RowKey<T>,
  previous: readonly (string | number)[],
): (string | number)[] {
  const pageKeys = rows.map(row => dataRowKey(row, key))
  const onPage = new Set(pageKeys.map(String))
  return [...previous.filter(selected => !onPage.has(String(selected))), ...pageKeys.filter(pageKey => state[String(pageKey)])]
}

/** UTable's body rows. UTable sets their attributes itself and takes none from the caller (Table.vue:316-322). */
export const TABLE_BODY_ROWS = 'tbody > tr[data-slot="tr"]'

/**
 * Gives UTable's rendered body rows the J / K contract after each render: `data-shortcut-row`, a
 * `data-row-index` for clicks, and `tabindex="-1"`, so a row can take focus without adding a tab stop.
 */
export function markTableRows(root: ParentNode): void {
  Array.from(root.querySelectorAll<HTMLElement>(TABLE_BODY_ROWS)).forEach((row, index) => {
    row.setAttribute('data-shortcut-row', '')
    row.setAttribute('data-row-index', String(index))
    if (!row.hasAttribute('tabindex')) row.setAttribute('tabindex', '-1')
  })
}

/** A control inside a row keeps its own click: a link, a checkbox, a menu, a field, the select column's cell. */
const ROW_CONTROL = 'a, button, input, select, textarea, label, [role="checkbox"], [role="combobox"], [role="menuitem"], .liwan-select-cell'

/** The index of the row a background click landed on, or null for a click on a control, outside a row, or on an unnumbered row. */
export function clickedRowIndex(target: unknown): number | null {
  if (!target || typeof (target as { closest?: unknown }).closest !== 'function') return null
  const element = target as Element
  if (element.closest(ROW_CONTROL)) return null
  const raw = element.closest(ROW_SELECTOR)?.getAttribute('data-row-index')
  if (raw === null || raw === undefined) return null
  const index = Number(raw)
  return Number.isInteger(index) && index >= 0 ? index : null
}

/**
 * The container width under which a table stacks its rows as cards (layout rules in components.css, "Data tables").
 * The CSS container query uses the same 640px, so the roles below follow what the browser draws.
 */
export const STACK_BELOW_PX = 640
/** The least width, in rem (11rem), a table's title column keeps; the same floor components.css gives its cell. */
export const TITLE_FLOOR_REM = 11

type MetaValue = unknown
/** Joins a caller's `meta.class.*` (a string, or a function of the cell) with more classes. */
function joinClass(existing: MetaValue, added: string): MetaValue {
  if (!added) return existing
  if (typeof existing === 'function') return (arg: unknown) => [(existing as (a: unknown) => unknown)(arg), added].filter(Boolean).join(' ')
  return [existing, added].filter(Boolean).join(' ')
}
/** Adds custom properties to a caller's `meta.style.td` (an object, a string, or a function of the cell). */
function joinStyle(existing: MetaValue, added: Record<string, string>): MetaValue {
  if (typeof existing === 'function') return (arg: unknown) => [(existing as (a: unknown) => unknown)(arg), added]
  return existing ? [existing, added] : added
}

interface ColumnLike { id?: string; accessorKey?: string; header?: unknown; meta?: Record<string, unknown> }
/** The title column's cell: it takes the width the other columns leave and truncates instead of pushing the table past its card. */
const TITLE_CELL_CLASS = 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
const idOf = (column: ColumnLike) => column.id ?? column.accessorKey

/** A quoted CSS string for `content: var(--liwan-label)`. */
const cssString = (text: string) => JSON.stringify(text.replace(/\s+/g, ' ').trim())

/**
 * Gives each column the classes the table layout reads (components.css, "Data tables"): the first data column and the
 * select column stick to the start edge, a last `actions` column to the end edge, `meta.numeric` aligns numbers at the
 * end, and a column whose header is a string carries it as `--liwan-label`, the label of its cell in the stacked row card.
 * The caller's own `meta` classes and styles are kept. `columns` already holds the select column first when `selectable`.
 */
export function decorateColumns<T>(columns: TableColumn<T>[], selectable: boolean): TableColumn<T>[] {
  const first = selectable ? 1 : 0
  // The title column is the first data column unless a column flags `meta.title` (a table whose first column is a narrow record number).
  const flagged = columns.findIndex(column => (column as ColumnLike).meta?.title === true)
  const titleAt = flagged >= 0 ? flagged : first
  return columns.map((column, index) => {
    const source = column as ColumnLike
    const id = idOf(source)
    const meta = (source.meta ?? {}) as { class?: { th?: MetaValue; td?: MetaValue }; style?: { td?: MetaValue }; numeric?: boolean; actions?: boolean }
    let th = ''
    let td = ''
    let label: string | undefined
    if (id === 'select') {
      th = td = 'liwan-sticky-start liwan-cell-select'
    } else if (id === 'actions' || meta.actions) {
      const end = index === columns.length - 1 ? ' liwan-sticky-end' : ''
      const named = typeof source.header === 'string' ? ' liwan-cell-actions-named' : ''
      th = td = `liwan-cell-actions${end}${named}`
    } else if (index === first || index === titleAt) {
      const classes = [index === first && 'liwan-sticky-start', index === titleAt && 'liwan-cell-title', index === first && selectable && 'liwan-sticky-second'].filter(Boolean).join(' ')
      th = classes
      td = flagged >= 0 && index === titleAt ? `${classes} ${TITLE_CELL_CLASS}` : classes
    } else if (typeof source.header === 'string' && source.header) {
      label = source.header
    }
    if (meta.numeric) th = td = `${th} text-end tabular-nums`.trim()
    if (!th && !td && !label) return column
    return {
      ...column,
      meta: {
        ...meta,
        class: { ...meta.class, th: joinClass(meta.class?.th, th), td: joinClass(meta.class?.td, td) },
        ...(label ? { style: { ...meta.style, td: joinStyle(meta.style?.td, { '--liwan-label': cssString(label) }) } } : {}),
      },
    } as TableColumn<T>
  })
}

/** What the scroll container shows beyond its edges, for the fades and the sticky columns' dividers. */
export interface ScrollEdges { scrolledStart: boolean; canScrollEnd: boolean }

/** The edges of a horizontally scrolling element. `scrollLeft` is 0 at the start and negative in RTL, so its magnitude is used. */
export function scrollEdges(el: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>): ScrollEdges {
  const max = el.scrollWidth - el.clientWidth
  const position = Math.abs(el.scrollLeft)
  return { scrolledStart: position > 1, canScrollEnd: max > 1 && position < max - 1 }
}

/** Writes the edges as `data-scrolled-start` / `data-can-scroll-end` on the table frame (the CSS reads them). */
export function applyScrollEdges(frame: Pick<HTMLElement, 'toggleAttribute'>, edges: ScrollEdges): void {
  frame.toggleAttribute('data-scrolled-start', edges.scrolledStart)
  frame.toggleAttribute('data-can-scroll-end', edges.canScrollEnd)
}

/**
 * Table roles for the stacked layout: `display: block` drops a table's native semantics in browsers, so while the rows
 * are cards each element gets its role back (the header row is visually hidden, not removed), and a table drawn as a
 * table keeps its native elements bare. UTable's empty separator row is presentational either way.
 */
const STACKED_ROLES: readonly (readonly [string, string])[] = [
  ['table', 'table'], ['thead, tbody', 'rowgroup'], ['tr:not([data-slot="separator"])', 'row'], ['th', 'columnheader'], ['td', 'cell'],
]
export function markTableRoles(root: ParentNode, stacked: boolean): void {
  if (!stacked) {
    root.querySelectorAll<HTMLElement>('[data-stacked-role]').forEach((el) => { el.removeAttribute('role'); el.removeAttribute('data-stacked-role') })
    return
  }
  for (const [selector, role] of STACKED_ROLES) {
    root.querySelectorAll<HTMLElement>(selector).forEach((el) => { el.setAttribute('role', role); el.setAttribute('data-stacked-role', '') })
  }
  root.querySelectorAll<HTMLElement>('tr[data-slot="separator"]').forEach((el) => { el.setAttribute('role', 'presentation'); el.setAttribute('data-stacked-role', '') })
}

/**
 * The smallest width a fixed-layout table needs so its title column keeps `floor` px: the other columns' width (the table less
 * the title) plus the title's own floor, which is the larger of that and the `min-width` its header declares (`NaN` for `auto`).
 * Table layout ignores `min-width` on cells, so a caller's `table-fixed` table whose fixed columns fill the card would
 * otherwise give the title column no width at all; the frame sets this as `--liwan-table-min` (components.css, "Data tables").
 * `tableWidth` and `titleWidth` must be measured with no `--liwan-table-min` applied (see `settleTableMin`): measured under the
 * minimum, the other columns have already been stretched by it and every pass would raise it again.
 */
export function tableMinWidth(tableWidth: number, titleWidth: number, declaredMin: number, floor: number): number {
  return Math.ceil(tableWidth - titleWidth + Math.max(Number.isFinite(declaredMin) ? declaredMin : 0, floor))
}

/** The frame custom property the table's `min-width` reads (components.css, "Data tables"). */
export const TABLE_MIN_PROPERTY = '--liwan-table-min'

/** The widths `tableMinWidth` is computed from. */
export interface TableMinSample { tableWidth: number; titleWidth: number; declaredMin: number }

/**
 * Sets the frame's `--liwan-table-min` from a measurement taken with the property cleared, so the result depends only on the
 * columns and the card, never on the previous result: repeating it (a resize, a patch, the observer that its own change
 * wakes) reaches the same value instead of growing. `sample` reads the layout (it forces one), and the property is back in
 * place before the browser paints, so nothing flickers.
 */
export function settleTableMin(frame: Pick<HTMLElement, 'style'>, sample: () => TableMinSample, floor: number): void {
  frame.style.removeProperty(TABLE_MIN_PROPERTY)
  const { tableWidth, titleWidth, declaredMin } = sample()
  frame.style.setProperty(TABLE_MIN_PROPERTY, `${tableMinWidth(tableWidth, titleWidth, declaredMin, floor)}px`)
}
