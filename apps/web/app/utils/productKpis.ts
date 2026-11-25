import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { PRODUCTS_LIST_PATH } from '../composables/products/productListParams'

export interface ProductKpiCounts {
  total?: number
  goods?: number
  services?: number
}

export interface ProductKpiScope {
  q?: string
  archived?: boolean
}

type Translate = (key: string) => string

/** The three tiles above `/products`: total, goods, and services (preserving `q` and `archived`). */
export function productKpiTiles(counts: ProductKpiCounts, scope: ProductKpiScope, t: Translate): KpiTile[] {
  const baseScope = {
    q: scope.q || undefined,
    archived: scope.archived || undefined,
  }
  const base = kpiLink(PRODUCTS_LIST_PATH, baseScope)
  return [
    {
      id: 'total',
      label: t('products.kpi.total'),
      icon: 'i-lucide-package',
      tone: 'neutral',
      value: counts.total ?? null,
      to: base,
      clearTo: base,
    },
    {
      id: 'goods',
      label: t('products.kpi.goods'),
      icon: 'i-lucide-box',
      tone: 'neutral',
      value: counts.goods ?? null,
      to: kpiLink(PRODUCTS_LIST_PATH, { ...baseScope, type: 'goods' }),
      clearTo: base,
    },
    {
      id: 'services',
      label: t('products.kpi.services'),
      icon: 'i-lucide-briefcase',
      tone: 'neutral',
      value: counts.services ?? null,
      to: kpiLink(PRODUCTS_LIST_PATH, { ...baseScope, type: 'service' }),
      clearTo: base,
    },
  ]
}
