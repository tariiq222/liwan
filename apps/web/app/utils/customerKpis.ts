import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { CUSTOMERS_LIST_PATH } from '../composables/customers/customerListParams'

export interface CustomerKpiCounts {
  active?: number
  archived?: number
}

export interface CustomerKpiScope {
  q?: string
}

type Translate = (key: string) => string

/**
 * The three tiles above `/customers`: total (active + archived), active, and archived.
 * Only one extra `limit: 1` query is needed because the page's own list total supplies whichever
 * bucket (`active` or `archived`) is currently open.
 */
export function customerKpiTiles(counts: CustomerKpiCounts, scope: CustomerKpiScope, t: Translate): KpiTile[] {
  const baseScope = { q: scope.q || undefined }
  const base = kpiLink(CUSTOMERS_LIST_PATH, baseScope)
  const total = counts.active !== undefined && counts.archived !== undefined ? counts.active + counts.archived : null
  return [
    {
      id: 'total',
      label: t('customers.kpi.total'),
      icon: 'i-lucide-users',
      tone: 'neutral',
      value: total,
      to: base,
      clearTo: base,
      active: false,
    },
    {
      id: 'active',
      label: t('customers.kpi.active'),
      icon: 'i-lucide-user-check',
      tone: 'success',
      value: counts.active ?? null,
      to: base,
      clearTo: base,
    },
    {
      id: 'archived',
      label: t('customers.kpi.archived'),
      icon: 'i-lucide-archive',
      tone: 'neutral',
      value: counts.archived ?? null,
      to: kpiLink(CUSTOMERS_LIST_PATH, { ...baseScope, archived: true }),
      clearTo: base,
    },
  ]
}
