import { useFinanceAccountList } from '@/composables/finance/useFinanceAccounts'
import { accountFiltersFromQuery, accountListParams } from './accountListParams'

/** The heading of the chart of accounts page: title and the result count as a tag. It has no create link. */
export function useAccountListPage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const filters = computed(() => accountFiltersFromQuery(route.query))
  const query = useFinanceAccountList(() => accountListParams(filters.value), () => can('finance.accounts.read'))
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeAccounting.accounts.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  return reactive({
    title: t('financeAccounting.accounts.title'),
    tags,
  })
}
