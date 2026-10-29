// Relative import: this module is unit-tested directly under plain vitest.
import { plainShortcutBlocked, shortcutKey, type ShortcutKeyEvent } from './keymap'

/**
 * J or K by the shell keymap rule (so «ت» / «ن» work on Arabic), or ArrowDown / ArrowUp as the same
 * moves (j / k); null when the key must be left alone. The plain-key guard already skips typing
 * targets (input, select, textarea), a Select trigger, a listbox, a tree or a plain grid cell, and
 * an open menu, which is what keeps the arrows from hijacking those widgets.
 */
export function rowMove(event: ShortcutKeyEvent, context: { hydrated: boolean; overlayOpen: boolean }): 'j' | 'k' | null {
  if (event.shiftKey || plainShortcutBlocked(event, context)) return null
  if (event.key === 'ArrowDown') return 'j'
  if (event.key === 'ArrowUp') return 'k'
  const key = shortcutKey(event)
  return key === 'j' || key === 'k' ? key : null
}

/** The row J / K moves to, clamped to the list; from no row, J starts at the top and K at the bottom. */
export function nextRowIndex(current: number, count: number, move: 'j' | 'k'): number {
  if (count === 0) return -1
  if (current < 0) return move === 'j' ? 0 : count - 1
  return move === 'j' ? Math.min(current + 1, count - 1) : Math.max(current - 1, 0)
}

/** A subtree the user cannot reach: an inert region or one hidden from assistive technology. */
const UNREACHABLE_ROW = '[inert], [aria-hidden="true"]'

/**
 * The rows J / K may move between, in document order. A row under `display: none` has no client
 * rects. SharedDataTable renders its desktop table and its mobile list together and hides one with
 * CSS, so this filter is what keeps J on the rows the user can see.
 */
export function navigableRows<T extends { getClientRects(): { length: number }; closest(selectors: string): unknown }>(rows: readonly T[]): T[] {
  return rows.filter(row => row.getClientRects().length > 0 && !row.closest(UNREACHABLE_ROW))
}
