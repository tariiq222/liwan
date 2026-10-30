import type { FinanceAsset } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { queryPositiveInt, queryText } from '../../../utils/routeQuery'

export const ASSET_PAGE_SIZE = 25
export const ASSET_STATES = ['draft', 'open', 'close', 'removed'] as const satisfies readonly FinanceAsset['state'][]
export type AssetStateFilter = (typeof ASSET_STATES)[number]

/** What the filter bar can say: only the filters `GET /finance/assets` supports. */
export interface AssetListFilters {
  q: string
  state: AssetStateFilter | null
  profileId: number | null
  page: number
}

export interface AssetListParams {
  state?: AssetStateFilter
  profile_id?: number
  q?: string
  limit: number
  offset: number
}

/** The list filters out of a route query; anything the API would refuse is dropped. */
export function assetFiltersFromQuery(query: Record<string, unknown>): AssetListFilters {
  const state = queryText(query.state)
  return {
    q: queryText(query.q) ?? '',
    state: ASSET_STATES.find(value => value === state) ?? null,
    profileId: queryPositiveInt(query.profile_id),
    page: queryPositiveInt(query.page) ?? 1,
  }
}

/** The number of filters the bar has applied (the search box counts too). */
export function assetActiveFilterCount(filters: AssetListFilters): number {
  return Number(!!filters.q) + Number(!!filters.state) + Number(!!filters.profileId)
}

export function assetListParams(filters: AssetListFilters): AssetListParams {
  return {
    ...(filters.state ? { state: filters.state } : {}),
    ...(filters.profileId ? { profile_id: filters.profileId } : {}),
    ...(filters.q ? { q: filters.q } : {}),
    limit: ASSET_PAGE_SIZE,
    offset: (filters.page - 1) * ASSET_PAGE_SIZE,
  }
}

/** One KPI count: the list's own filters with the tile's state, and one row asked for because only `total` is read. */
export function assetKpiParams(filters: AssetListFilters, state: AssetStateFilter | null): AssetListParams {
  return { ...assetListParams({ ...filters, state, page: 1 }), limit: 1, offset: 0 }
}

export type AssetKpiId = 'total' | 'draft' | 'open' | 'close'
export type AssetKpiCounts = Record<AssetKpiId, number | undefined>

const KPI_IDS = ['total', 'draft', 'open', 'close'] as const satisfies readonly AssetKpiId[]
const KPI_TONE = { total: 'neutral', draft: 'warning', open: 'success', close: 'neutral' } as const
const KPI_ICON = { total: 'i-lucide-package', draft: 'i-lucide-file-pen', open: 'i-lucide-play', close: 'i-lucide-archive' } as const

/** The strip above the list: the counts the server reports for the list's filters: all, draft, running and closed. */
export function assetKpiTiles(counts: AssetKpiCounts, label: (id: AssetKpiId) => string): KpiTile[] {
  return KPI_IDS.map(id => ({
    id,
    label: label(id),
    value: counts[id] ?? null,
    icon: KPI_ICON[id],
    tone: KPI_TONE[id],
  }))
}
