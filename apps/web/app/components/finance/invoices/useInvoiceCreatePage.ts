import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { INVOICE_KINDS, invoiceRecordPath, type FinanceMoveType } from './invoiceKinds'
import { useInvoiceListPage } from './useInvoiceListPage'

/**
 * What a document's route-backed create page needs: the list that stays behind the panel (its header hidden), the
 * panel title and its way back, and where a saved draft goes: its record page, carrying the same list origin.
 */
export function useInvoiceCreatePage(moveType: FinanceMoveType) {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const kind = INVOICE_KINDS[moveType]
  const backTo = computed(() => safeReturnTo(route.query.returnTo, kind.listPath, [kind.listPath]))
  function saved(id: number) {
    void navigateTo({ path: invoiceRecordPath(moveType, id), query: { returnTo: backTo.value } }, { replace: true })
  }
  return reactive({
    list: useInvoiceListPage(moveType, true),
    title: t(`financeDocuments.kinds.${moveType}.new`),
    backTo,
    allowed: computed(() => can('finance.invoices.manage')),
    saved,
  })
}
