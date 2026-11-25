import { useFinanceInvoiceList } from '@/composables/finance/useFinanceInvoices'
import { useFinanceInvoiceSummary } from '@/composables/finance/useFinanceKpis'
import { INVOICE_KINDS, type FinanceMoveType } from './invoiceKinds'
import { invoiceFiltersFromQuery, invoiceKpiTiles, invoiceListParams, invoiceSummaryParams } from './invoiceListParams'
import { useListFilterQuery, useListLocation } from './listLocation'

/**
 * A document list page: its heading (title, the result count as a tag and the create link, which carries the list's
 * filters as its returnTo) and the KPI strip of its `#kpis` slot, filled from one summary request asked only while the
 * strip is shown. The pages own the SharedListPage shell and InvoiceList draws the card in it; `background` is the
 * list behind the create panel, so its header is hidden. The result is reactive so the page template unwraps it.
 */
export function useInvoiceListPage(moveType: FinanceMoveType, background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const { shown } = useKpiVisibility()
  const kind = INVOICE_KINDS[moveType]
  const allowed = computed(() => can('finance.invoices.read'))
  const filterQuery = useListFilterQuery(kind.listPath, background)
  const filters = computed(() => invoiceFiltersFromQuery(filterQuery.value))
  const query = useFinanceInvoiceList(() => invoiceListParams(moveType, filters.value), allowed)
  const summary = useFinanceInvoiceSummary(() => invoiceSummaryParams(moveType, filters.value), () => shown.value && allowed.value)
  const location = useListLocation(kind.listPath, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeDocuments.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.invoices.manage') ? { path: `${kind.listPath}/new`, query: { returnTo: location.value } } : undefined)
  const counts = computed(() => ({ total: summary.data.value?.total, draft: summary.data.value?.draft, posted: summary.data.value?.posted, cancel: summary.data.value?.cancel }))
  return reactive({
    header: {
      title: t(`financeDocuments.kinds.${moveType}.title`),
      tags,
      createTo,
      createLabel: t(`financeDocuments.kinds.${moveType}.new`),
      createTestId: `finance-${moveType}-new`,
      hideHeader: background,
    },
    kpis: {
      shown,
      label: t('financeDocuments.kpi.label'),
      tiles: computed(() => invoiceKpiTiles(moveType, filters.value, counts.value, t)),
      loading: computed(() => summary.isPending.value),
      error: computed(() => summary.isError.value),
    },
    allowed,
  })
}
