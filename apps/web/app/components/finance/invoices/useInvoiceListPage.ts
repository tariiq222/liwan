import { useFinanceInvoiceList } from '@/composables/finance/useFinanceInvoices'
import { INVOICE_KINDS, type FinanceMoveType } from './invoiceKinds'
import { invoiceFiltersFromQuery, invoiceListParams } from './invoiceListParams'
import { useListFilterQuery, useListLocation } from './listLocation'

/**
 * The heading of a document list page: title, description, the result count as a tag and the create link, which carries
 * the list's filters as its returnTo. The pages own the SharedListPage shell and InvoiceList draws the card in it;
 * `background` is the list behind the create panel, so its header is hidden. The result is reactive so `v-bind` in
 * the page template unwraps the computed values.
 */
export function useInvoiceListPage(moveType: FinanceMoveType, background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const kind = INVOICE_KINDS[moveType]
  const filterQuery = useListFilterQuery(kind.listPath, background)
  const filters = computed(() => invoiceFiltersFromQuery(filterQuery.value))
  const query = useFinanceInvoiceList(() => invoiceListParams(moveType, filters.value), () => can('finance.invoices.read'))
  const location = useListLocation(kind.listPath, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeDocuments.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.invoices.manage') ? { path: `${kind.listPath}/new`, query: { returnTo: location.value } } : undefined)
  return reactive({
    title: t(`financeDocuments.kinds.${moveType}.title`),
    description: t(`financeDocuments.kinds.${moveType}.description`),
    tags,
    createTo,
    createLabel: t(`financeDocuments.kinds.${moveType}.new`),
    createTestId: `finance-${moveType}-new`,
    hideHeader: background,
    kpiToggle: true,
  })
}
