import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { PAYMENTS_PATH, prefilledInvoiceIds } from './paymentModel'
import { usePaymentListPage } from './usePaymentListPage'

/**
 * What the payment create page needs: the payments list behind the panel, the panel's way back (the record the link
 * came from, or the list) and the documents `?invoice_ids=3,5` preselects. Saving returns to where the panel opened.
 */
export function usePaymentCreatePage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const backTo = computed(() => safeReturnTo(route.query.returnTo, PAYMENTS_PATH, ['/finance']))
  function saved() {
    void navigateTo(backTo.value, { replace: true })
  }
  return reactive({
    list: usePaymentListPage(true),
    title: t('financeDocuments.payments.new'),
    backTo,
    invoiceIds: computed(() => prefilledInvoiceIds(route.query.invoice_ids)),
    allowed: computed(() => can('finance.payments.manage')),
    saved,
  })
}
