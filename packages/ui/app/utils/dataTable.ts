// Relative import: this module is unit-tested directly under plain vitest.
import { ROW_SELECTOR } from '../composables/shortcuts/keymap'

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
const ROW_CONTROL = 'a, button, input, select, textarea, label, [role="checkbox"], [role="combobox"], [role="menuitem"], .nasq-select-cell'

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
