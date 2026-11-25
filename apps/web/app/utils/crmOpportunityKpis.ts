import type { CrmOpportunityFilters } from '@liwan/contracts'
import { kpiLink } from '@liwan/ui/app/utils/kpiLink'
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { CRM_LIST_PATH } from './crmOpportunity'

export type CrmOpportunityKpiId = 'open' | 'won' | 'lost' | 'due'
export type CrmOpportunityKpiCounts = Partial<Record<CrmOpportunityKpiId, number>>
export type CrmOpportunityScope = Omit<CrmOpportunityFilters, 'status' | 'due'>

type Translate = (key: string) => string

/** Scope filters kept across every CRM opportunity KPI tile (status and due belong to the tiles themselves). */
export function crmOpportunityKpiScope(filters: CrmOpportunityFilters): CrmOpportunityScope {
  const { status: _status, due: _due, ...scope } = filters
  return scope
}

/** Which KPI tile's query matches the current list query, so that tile can reuse the list's `total` with no extra request. */
export function crmOpportunityMatchingTile(filters: CrmOpportunityFilters): CrmOpportunityKpiId | null {
  if (filters.due) return !filters.status || filters.status === 'open' ? 'due' : null
  if (!filters.status || filters.status === 'open') return 'open'
  if (filters.status === 'won') return 'won'
  if (filters.status === 'lost') return 'lost'
  return null
}

/** Per-tile API filters added on top of the page's scope filters; each count is requested with `limit: 1`. */
export function crmOpportunityKpiFilters(scope: CrmOpportunityScope): Record<CrmOpportunityKpiId, CrmOpportunityFilters> {
  return {
    open: { ...scope },
    won: { ...scope, status: 'won' },
    lost: { ...scope, status: 'lost' },
    due: { ...scope, due: true },
  }
}

/** The four tiles above `/crm/opportunities`: open, won, lost, and due follow-ups. */
export function crmOpportunityKpiTiles(
  counts: CrmOpportunityKpiCounts,
  scope: CrmOpportunityScope,
  t: Translate,
  view?: string,
): KpiTile[] {
  const baseScope = {
    q: scope.q,
    stage_id: scope.stage_id,
    user_id: scope.user_id,
    source_id: scope.source_id,
    unassigned: scope.unassigned || undefined,
    needs_manager: scope.needs_manager || undefined,
    view: view || undefined,
  }
  const base = kpiLink(CRM_LIST_PATH, baseScope)
  return [
    {
      id: 'open',
      label: t('crm.opportunities.kpi.open'),
      icon: 'i-lucide-handshake',
      tone: 'neutral',
      value: counts.open ?? null,
      to: base,
      clearTo: base,
    },
    {
      id: 'won',
      label: t('crm.opportunities.kpi.won'),
      icon: 'i-lucide-circle-check',
      tone: 'success',
      value: counts.won ?? null,
      to: kpiLink(CRM_LIST_PATH, { ...baseScope, status: 'won' }),
      clearTo: base,
    },
    {
      id: 'lost',
      label: t('crm.opportunities.kpi.lost'),
      icon: 'i-lucide-circle-x',
      tone: counts.lost ? 'danger' : 'neutral',
      value: counts.lost ?? null,
      to: kpiLink(CRM_LIST_PATH, { ...baseScope, status: 'lost' }),
      clearTo: base,
    },
    {
      id: 'due',
      label: t('crm.opportunities.kpi.due'),
      icon: 'i-lucide-phone-forwarded',
      tone: counts.due ? 'warning' : 'neutral',
      value: counts.due ?? null,
      to: kpiLink(CRM_LIST_PATH, { ...baseScope, due: true }),
      clearTo: base,
    },
  ]
}
