import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'
import { ROW_SELECTOR } from './shortcuts/keymap'
import { navigableRows, nextRowIndex, rowMove } from './shortcuts/rows'
import { overlayOwnsEscape } from './useEscapeBack'

/**
 * J / K (and ArrowDown / ArrowUp once focus is inside the list) move focus between the rows `container` marked with
 * `data-shortcut-row` (each focusable), and Enter on a focused row opens its first link, or clicks the row itself when the
 * table navigates through `row-to` and holds no link. A list opts in
 * by calling this with its container; SharedDataTable wires it, the shell does not. The shell
 * listener runs first (window, capture) and default-prevents a key it used, including the letter
 * after a pending `G`, so this skips it.
 *
 * One list per page: this listens on the document, so two containers on one page would both answer
 * J / K. A page shows one SharedDataTable; any second list on that page is a plain table.
 */
export function useRowNavigation(container: Readonly<Ref<HTMLElement | null>>) {
  const hydrated = useHydrated()
  useEventListener(() => (typeof document === 'undefined' ? null : document), 'keydown', (event: KeyboardEvent) => {
    const root = container.value
    if (!root || event.defaultPrevented) return
    const rows = navigableRows(Array.from(root.querySelectorAll<HTMLElement>(ROW_SELECTOR)))
    const focused = document.activeElement
    const current = rows.findIndex(row => row === focused || (focused !== null && row.contains(focused)))
    const move = rowMove(event, { hydrated: hydrated.value, overlayOpen: overlayOwnsEscape(document), inList: current >= 0 })
    if (move) {
      const next = nextRowIndex(current, rows.length, move)
      if (next < 0) return
      event.preventDefault()
      rows[next]!.focus()
      rows[next]!.scrollIntoView({ block: 'nearest' })
      return
    }
    if (event.key === 'Enter' && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey
      && current >= 0 && rows[current] === focused) {
      // The row's own link, when a cell holds one. A table that navigates through `row-to` marks the row instead
      // (`data-row-opens`, set by SharedDataTable), because its rows are `<tr>` and have no <a> at all: that is the case
      // Enter used to miss. Clicking the row runs the table's own handler, so the pointer and the keyboard agree.
      const row = rows[current]!
      const link = row.querySelector<HTMLElement>('a[href]')
      const opens = row.hasAttribute('data-row-opens')
      if (link) {
        event.preventDefault()
        link.click()
      } else if (opens) {
        event.preventDefault()
        row.click()
      }
    }
  })
}
