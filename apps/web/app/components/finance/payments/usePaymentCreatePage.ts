import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { PAYMENTS_PATH, prefilledInvoiceIds } from './paymentModel'
import { usePaymentListPage } from './usePaymentListPage'

/**
 * What the payment create page needs: the payments list behind the panel, the panel's way back (the record the link
 * came from, or the list) and the documents `?invoice_ids=3,5` preselects. Saving returns to where the panel opened. The transfer panel (`mode: 'transfer'`) shares
 * the list behind it, the way back and the capability, and has no documents or standalone variant.
 */
export function usePaymentCreatePage(mode: 'register' | 'transfer' = 'register') {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const backTo = computed(() => safeReturnTo(route.query.returnTo, PAYMENTS_PATH, ['/finance']))
  function saved() {
    void navigateTo(backTo.value, { replace: true })
  }
  return reactive({
    list: usePaymentListPage(true),
    standalone: computed(() => mode === 'register' && route.query.kind === 'standalone'),
    title: computed(() => t(mode === 'transfer' ? 'financeDocuments.payments.transfer.title' : route.query.kind === 'standalone' ? 'financeDocuments.payments.standalone.title' : 'financeDocuments.payments.new')),
    backTo,
    invoiceIds: computed(() => prefilledInvoiceIds(route.query.invoice_ids)),
    allowed: computed(() => can('finance.payments.manage')),
    saved,
  })
}
