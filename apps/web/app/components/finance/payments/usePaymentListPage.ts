import { useFinancePayments } from '@/composables/finance/useFinancePayments'
import { useListFilterQuery, useListLocation } from '../invoices/listLocation'
import { PAYMENTS_PATH, paymentFiltersFromQuery, paymentListParams } from './paymentModel'

/** The heading of the payments page: title, count tag and the create link carrying the list's filters (see useInvoiceListPage). */
export function usePaymentListPage(background = false) {
  const { t } = useI18n()
  const { can } = useAccess()
  const filterQuery = useListFilterQuery(PAYMENTS_PATH, background)
  const filters = computed(() => paymentFiltersFromQuery(filterQuery.value))
  const query = useFinancePayments(() => paymentListParams(filters.value), () => can('finance.payments.read'))
  const location = useListLocation(PAYMENTS_PATH, background)
  const total = computed(() => query.data.value?.total ?? 0)
  const tags = computed(() => query.data.value ? [{ label: t('financeDocuments.countTag', { count: total.value }, total.value), kind: 'count' as const }] : [])
  const createTo = computed(() => can('finance.payments.manage') ? { path: `${PAYMENTS_PATH}/new`, query: { returnTo: location.value } } : undefined)
  return reactive({
    title: t('financeDocuments.payments.title'),
    tags,
    createTo,
    createLabel: t('financeDocuments.payments.new'),
    createTestId: 'finance-payment-new',
    hideHeader: background,
  })
}
