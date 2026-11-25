import { useFinanceBankStatements } from '@/composables/finance/useFinanceBank'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'
import { BANK_STATEMENTS_PATH } from './bankModel'
import { bankActiveFilterCount, bankFiltersFromQuery, bankKpiParams, bankKpiTiles, bankListParams } from './bankListParams'

/**
 * The heading of the statements page: title, count tag and the create link carrying the list's filters as its
 * returnTo (see useInvoiceListPage), and the KPI strip of its `#kpis` slot. The all-statements figure is one `limit=1`
 * request without filters; the filtered figure is the list's own total, asked once. `background` is the list behind
 * the create panel, so only its header is hidden; the list and its strip stay drawn under the panel.
 */
export function useBankListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const { shown } = useKpiVisibility()
  const allowed = computed(() => can('finance.bank.read'))
  const filterQuery = useListFilterQuery(BANK_STATEMENTS_PATH, background)
  const filters = computed(() => bankFiltersFromQuery(filterQuery.value))
  const query = useFinanceBankStatements(() => bankListParams(filters.value), allowed)
  const all = useFinanceBankStatements(() => bankKpiParams(null), () => shown.value && allowed.value)
  const location = useListLocation(BANK_STATEMENTS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const filtered = computed(() => bankActiveFilterCount(filters.value) > 0)
  // No figure while the list is loading or still showing the previous filters' rows, so the tile never claims a 0 or a stale count.
  const filteredTotal = computed(() => (query.isPending.value || query.isPlaceholderData.value ? null : query.data.value?.total ?? 0))
  const tags = computed(() => query.data.value ? [{ label: t('financeBank.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.bank.manage') ? { path: `${BANK_STATEMENTS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  const counts = computed(() => ({ all: all.data.value?.total, filtered: filtered.value ? filteredTotal.value : undefined }))
  return reactive({
    header: {
      title: t('financeBank.title'),
      tags,
      createTo,
      createLabel: t('financeBank.new'),
      createTestId: 'finance-bank-statement-new',
      hideHeader: background,
    },
    kpis: {
      shown,
      label: t('financeBank.kpi.label'),
      tiles: computed(() => bankKpiTiles(filters.value, counts.value, id => t(`financeBank.kpi.${id}`))),
      loading: computed(() => all.isPending.value),
      error: computed(() => all.isError.value),
    },
    allowed,
  })
}
