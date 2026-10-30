import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import type { OperationPurpose } from '@liwan/contracts'
import type { OperationScope } from './useOperations'

type Translate = (key: string) => string

/** The request state each tile adds to its list's own scope (`undefined` counts every request of the scope). Only states the list API filters on. */
export const operationKpiStates = {
  mine: { total: undefined, pending: 'pending', returned: 'returned', done: 'done' },
  pending: { awaiting: undefined },
  monitoring: { pending: 'pending', returned: 'returned', rejected: 'rejected', done: 'done' },
} as const satisfies Record<OperationScope, Record<string, string | undefined>>

export type OperationKpiId<S extends OperationScope> = keyof typeof operationKpiStates[S] & string

const listPath = (scope: OperationScope) => scope === 'mine' ? '/operations' : `/operations/${scope}`

/** A link to the scope's list filtered by a tile's state (and the page's search and type filter); the pending list is already one state, so it gets none. */
export function operationKpiLink(scope: OperationScope, state: string | undefined, q?: string, purpose?: OperationPurpose): string {
  const query = new URLSearchParams()
  if (q) query.set('q', q)
  if (purpose) query.set('purpose', purpose)
  if (state && scope !== 'pending') query.set('state', state)
  const text = query.toString()
  return text ? `${listPath(scope)}?${text}` : listPath(scope)
}

const TILE_LOOK = {
  total: { icon: 'i-lucide-list-checks', tone: 'neutral' },
  awaiting: { icon: 'i-lucide-clock', tone: 'warning' },
  pending: { icon: 'i-lucide-clock', tone: 'warning' },
  returned: { icon: 'i-lucide-undo-2', tone: 'warning' },
  rejected: { icon: 'i-lucide-circle-x', tone: 'danger' },
  done: { icon: 'i-lucide-circle-check', tone: 'success' },
} as const satisfies Record<string, Pick<KpiTile, 'icon' | 'tone'>>

/** The tiles above an operations request list: one per entry of `operationKpiStates[scope]`; a count that has not arrived is `null` and shows "—". */
export function operationKpiTiles(scope: OperationScope, counts: Record<string, number | undefined>, t: Translate, q?: string, purpose?: OperationPurpose): KpiTile[] {
  return Object.entries(operationKpiStates[scope]).map(([id, state]) => {
    const look = TILE_LOOK[id as keyof typeof TILE_LOOK]
    return { id, label: t(`operations.kpi.${scope}.${id}`), icon: look.icon, tone: look.tone, value: counts[id] ?? null, to: operationKpiLink(scope, state, q, purpose) }
  })
}
