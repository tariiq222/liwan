import type { SalesOrderSource } from '@liwan/contracts'
import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { SALES_LIST_PATH, type SalesStage } from '../composables/sales/salesListParams'

export type SalesKpiStage = Exclude<SalesStage, 'all'>
export type SalesKpiCounts = Partial<Record<SalesKpiStage, number>>

export interface SalesKpiScope {
  q?: string
  source?: SalesOrderSource | null
  mine?: boolean
}

type Translate = (key: string) => string

/** The three tiles above `/sales`: quotations, orders, and cancelled (matching the list's `state` stages). */
export function salesKpiTiles(counts: SalesKpiCounts, scope: SalesKpiScope, t: Translate): KpiTile[] {
  const baseScope = {
    q: scope.q || undefined,
    source: scope.source || undefined,
    mine: scope.mine || undefined,
  }
  const base = kpiLink(SALES_LIST_PATH, baseScope)
  return [
    {
      id: 'quotations',
      label: t('sales.kpi.quotations'),
      icon: 'i-lucide-file-text',
      tone: 'neutral',
      value: counts.quotations ?? null,
      to: kpiLink(SALES_LIST_PATH, { ...baseScope, state: 'quotations' }),
      clearTo: base,
    },
    {
      id: 'orders',
      label: t('sales.kpi.orders'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.orders ?? null,
      to: kpiLink(SALES_LIST_PATH, { ...baseScope, state: 'orders' }),
      clearTo: base,
    },
    {
      id: 'cancelled',
      label: t('sales.kpi.cancelled'),
      icon: 'i-lucide-circle-x',
      tone: counts.cancelled ? 'danger' : 'neutral',
      value: counts.cancelled ?? null,
      to: kpiLink(SALES_LIST_PATH, { ...baseScope, state: 'cancelled' }),
      clearTo: base,
    },
  ]
}
