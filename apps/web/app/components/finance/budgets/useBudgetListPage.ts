import { useFinanceBudgetList } from '@/composables/finance/useFinanceBudgets'
import { useFinanceBudgetSummary } from '@/composables/finance/useFinanceKpis'
import { budgetFiltersFromQuery, budgetKpiTiles, budgetListParams, budgetSummaryParams } from './budgetListParams'
import { BUDGETS_PATH } from './budgetPaths'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'

/**
 * The budgets list page: its heading (title, the result count as a tag and the create link, which carries the list's
 * filters as its returnTo) and the KPI strip of its `#kpis` slot, filled from one summary request asked only while the
 * strip is shown. The page owns the SharedListPage shell and BudgetList draws the card in it; `background` is the list
 * behind the create panel, so its header is hidden. The result is reactive so the page template unwraps it.
 */
export function useBudgetListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const { shown } = useKpiVisibility()
  const allowed = computed(() => can('finance.budgets.read'))
  const filterQuery = useListFilterQuery(BUDGETS_PATH, background)
  const filters = computed(() => budgetFiltersFromQuery(filterQuery.value))
  const query = useFinanceBudgetList(() => budgetListParams(filters.value), allowed)
  const summary = useFinanceBudgetSummary(() => budgetSummaryParams(filters.value), () => shown.value && allowed.value)
  const location = useListLocation(BUDGETS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeBudgets.budgets.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.budgets.manage') ? { path: `${BUDGETS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  const counts = computed(() => ({ total: summary.data.value?.total, draft: summary.data.value?.draft, confirmed: summary.data.value?.confirmed, cancelled: summary.data.value?.cancelled }))
  return reactive({
    header: {
      title: t('financeBudgets.budgets.title'),
      tags,
      createTo,
      createLabel: t('financeBudgets.budgets.new'),
      createTestId: 'finance-budget-new',
      hideHeader: background,
    },
    kpis: {
      shown,
      label: t('financeBudgets.kpi.label'),
      tiles: computed(() => budgetKpiTiles(filters.value, counts.value, t)),
      loading: computed(() => summary.isPending.value),
      error: computed(() => summary.isError.value),
    },
    allowed,
  })
}
