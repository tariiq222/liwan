// Relative imports: this module is unit-tested directly under plain vitest.
import type { AppQuickPanel } from '../../modules/types'

/** The bar shows conversations, then tasks, then meetings; a panel a newer application declares follows in manifest order. */
const BAR_ORDER = ['chat', 'tasks', 'meetings'] as const

export function orderQuickPanels(panels: readonly AppQuickPanel[]): AppQuickPanel[] {
  const rank = (panel: AppQuickPanel) => {
    const index = (BAR_ORDER as readonly string[]).indexOf(panel.id)
    return index === -1 ? BAR_ORDER.length : index
  }
  return panels.map((panel, position) => ({ panel, position })).sort((a, b) => rank(a.panel) - rank(b.panel) || a.position - b.position).map(entry => entry.panel)
}

/** The badge of a tool: nothing until the count is known and nothing for zero. */
export function toolBadge(count: number | null): number | null {
  return count && count > 0 ? count : null
}
