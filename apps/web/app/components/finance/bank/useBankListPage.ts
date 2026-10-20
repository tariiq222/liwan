import { useFinanceBankStatements } from '@/composables/finance/useFinanceBank'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'
import { bankFiltersFromQuery, bankListParams } from './bankListParams'
import { BANK_STATEMENTS_PATH } from './bankModel'

/**
 * The heading of the statements page: title, count tag and the create link carrying the list's filters as its
 * returnTo (see useInvoiceListPage). `background` is the list behind the create panel, so its header is hidden.
 */
export function useBankListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const filterQuery = useListFilterQuery(BANK_STATEMENTS_PATH, background)
  const filters = computed(() => bankFiltersFromQuery(filterQuery.value))
  const query = useFinanceBankStatements(() => bankListParams(filters.value), () => can('finance.bank.read'))
  const location = useListLocation(BANK_STATEMENTS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeBank.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.bank.manage') ? { path: `${BANK_STATEMENTS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  return reactive({
    title: t('financeBank.title'),
    description: t('financeBank.description'),
    tags,
    createTo,
    createLabel: t('financeBank.new'),
    createTestId: 'finance-bank-statement-new',
    hideHeader: background,
    kpiToggle: true,
  })
}
