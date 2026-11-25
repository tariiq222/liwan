import { useFinanceEntryList } from '@/composables/finance/useFinanceEntries'
import { useFinanceEntrySummary } from '@/composables/finance/useFinanceKpis'
import { entryFiltersFromQuery, entryKpiTiles, entryListParams, entrySummaryParams } from './entryListParams'
import { ENTRIES_PATH } from './entryPaths'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'

/**
 * The journal entries list page: its heading (title, the result count as a tag and the create link, which carries the
 * list's filters as its returnTo) and the KPI strip of its `#kpis` slot, filled from one summary request asked only
 * while the strip is shown. The page owns the SharedListPage shell and EntryList draws the card in it; `background` is
 * the list behind the create panel, so its header is hidden. The result is reactive so the page template unwraps it.
 */
export function useEntryListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const { shown } = useKpiVisibility()
  const allowed = computed(() => can('finance.entries.read'))
  const filterQuery = useListFilterQuery(ENTRIES_PATH, background)
  const filters = computed(() => entryFiltersFromQuery(filterQuery.value))
  const query = useFinanceEntryList(() => entryListParams(filters.value), allowed)
  const summary = useFinanceEntrySummary(() => entrySummaryParams(filters.value), () => shown.value && allowed.value)
  const location = useListLocation(ENTRIES_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeAccounting.entries.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.entries.manage') ? { path: `${ENTRIES_PATH}/new`, query: { returnTo: location.value } } : undefined)
  const counts = computed(() => ({ total: summary.data.value?.total, draft: summary.data.value?.draft, posted: summary.data.value?.posted, cancel: summary.data.value?.cancel }))
  return reactive({
    header: {
      title: t('financeAccounting.entries.title'),
      tags,
      createTo,
      createLabel: t('financeAccounting.entries.new'),
      createTestId: 'finance-entry-new',
      hideHeader: background,
    },
    kpis: {
      shown,
      label: t('financeAccounting.kpi.label'),
      tiles: computed(() => entryKpiTiles(filters.value, counts.value, t)),
      loading: computed(() => summary.data.value === undefined),
    },
    allowed,
  })
}
