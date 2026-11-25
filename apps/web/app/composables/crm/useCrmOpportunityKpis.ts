import type { CrmOpportunityFilters } from '@liwan/contracts'
import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import {
  crmOpportunityKpiFilters,
  crmOpportunityKpiScope,
  crmOpportunityKpiTiles,
  crmOpportunityMatchingTile,
  type CrmOpportunityKpiId,
} from '@/utils/crmOpportunityKpis'
import { useCrmOpportunities } from './useOpportunities'

/**
 * The four KPI tiles above `/crm/opportunities` (open, won, lost, due follow-ups).
 * Each tile asks `/api/v1/crm/opportunities` for `limit: 1` under the page's scope filters while KPIs are visible,
 * except the tile matching the active list filter, which reuses `listTotal` with no extra request.
 */
export function useCrmOpportunityKpis(
  filters: MaybeRefOrGetter<CrmOpportunityFilters>,
  listTotal: MaybeRefOrGetter<number | undefined>,
  enabled: MaybeRefOrGetter<boolean> = true,
  view?: MaybeRefOrGetter<string | undefined>,
) {
  const { t } = useI18n()
  const scope = computed(() => crmOpportunityKpiScope(toValue(filters)))
  const matching = computed(() => crmOpportunityMatchingTile(toValue(filters)))
  const perTile = computed(() => crmOpportunityKpiFilters(scope.value))

  const tileQuery = (id: CrmOpportunityKpiId) => useCrmOpportunities(
    () => ({ ...perTile.value[id], limit: 1, offset: 0 }),
    () => toValue(enabled) && matching.value !== id,
  )

  const queries = {
    open: tileQuery('open'),
    won: tileQuery('won'),
    lost: tileQuery('lost'),
    due: tileQuery('due'),
  }

  const countFor = (id: CrmOpportunityKpiId) => (matching.value === id ? toValue(listTotal) : queries[id].data.value?.total)

  const tiles = computed(() => crmOpportunityKpiTiles({
    open: countFor('open'),
    won: countFor('won'),
    lost: countFor('lost'),
    due: countFor('due'),
  }, scope.value, t, toValue(view)))

  const loading = computed(() =>
    (matching.value !== null && toValue(listTotal) === undefined)
    || Object.values(queries).some(query => query.isLoading.value),
  )

  return { tiles, loading }
}
