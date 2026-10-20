import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { BUDGETS_PATH, budgetRecordPath } from './budgetPaths'
import { useBudgetListPage } from './useBudgetListPage'

/**
 * What the budget create page needs: the list that stays behind the panel (its header hidden), the panel title and its
 * way back, and where a saved budget goes: its record page, carrying the same list origin.
 */
export function useBudgetCreatePage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const backTo = computed(() => safeReturnTo(route.query.returnTo, BUDGETS_PATH, [BUDGETS_PATH]))
  function saved(id: number) {
    void navigateTo({ path: budgetRecordPath(id), query: { returnTo: backTo.value } }, { replace: true })
  }
  return reactive({
    list: useBudgetListPage(true),
    title: t('financeBudgets.budgets.new'),
    backTo,
    allowed: computed(() => can('finance.budgets.manage')),
    saved,
  })
}
