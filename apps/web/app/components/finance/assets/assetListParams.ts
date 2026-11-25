import type { FinanceAsset } from '@liwan/contracts'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { financeListKpiTiles, financeStateTiles } from '../../../utils/financeKpis'
import { queryPositiveInt, queryText } from '../../../utils/routeQuery'
import { ASSETS_PATH } from './assetPaths'

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

/** The summary has the list filters, without its selected state or page window. */
export function assetSummaryParams(filters: AssetListFilters) {
  const { state: _state, limit: _limit, offset: _offset, ...params } = assetListParams(filters)
  return params
}

export type AssetKpiId = 'total' | 'draft' | 'open' | 'close'
export type AssetKpiCounts = Record<AssetKpiId, number | undefined>

const ASSET_KPI_STATES = [
  { id: 'draft', icon: 'i-lucide-file-pen', tone: 'warning' },
  { id: 'open', icon: 'i-lucide-play', tone: 'success' },
  { id: 'close', icon: 'i-lucide-archive', tone: 'neutral' },
] as const

/** The strip above the list: all, draft, running and closed, linked to the list's own filters. */
export function assetKpiTiles(filters: AssetListFilters, counts: AssetKpiCounts, t: (key: string) => string): KpiTile[] {
  return financeListKpiTiles(
    financeStateTiles(ASSET_KPI_STATES, 'i-lucide-package', id => t(`financeAssets.kpi.${id}`)),
    counts,
    ASSETS_PATH,
    { q: filters.q, profile_id: filters.profileId ?? undefined },
  )
}
