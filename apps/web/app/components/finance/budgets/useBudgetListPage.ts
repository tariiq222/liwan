import { useFinanceBudgetList } from '@/composables/finance/useFinanceBudgets'
import { budgetFiltersFromQuery, budgetListParams } from './budgetListParams'
import { BUDGETS_PATH } from './budgetPaths'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'

/**
 * The heading of the budgets list page: title, the result count as a tag and the create link, which
 * carries the list's filters as its returnTo. The page owns the SharedListPage shell and BudgetList draws the card in
 * it; `background` is the list behind the create panel, so its header is hidden. The result is reactive so `v-bind`
 * in the page template unwraps the computed values.
 */
export function useBudgetListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const filterQuery = useListFilterQuery(BUDGETS_PATH, background)
  const filters = computed(() => budgetFiltersFromQuery(filterQuery.value))
  const query = useFinanceBudgetList(() => budgetListParams(filters.value), () => can('finance.budgets.read'))
  const location = useListLocation(BUDGETS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeBudgets.budgets.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.budgets.manage') ? { path: `${BUDGETS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  return reactive({
    title: t('financeBudgets.budgets.title'),
    tags,
    createTo,
    createLabel: t('financeBudgets.budgets.new'),
    createTestId: 'finance-budget-new',
    hideHeader: background,
    kpiToggle: true,
  })
}
