import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { statusTag, type PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import {
  useCreateFinanceDebitNote,
  useDeleteFinanceInvoice,
  useFinanceInvoice,
  useFinanceInvoiceTransition,
  useFinanceZatcaSubmit,
  type FinanceInvoiceTransition,
} from '@/composables/finance/useFinanceInvoices'
import { registerPaymentLink } from '../payments/paymentModel'
import { invoiceActions } from './invoiceActions'
import { financeErrorKey, zatcaSubmissionFromDetails } from './invoiceErrors'
import { INVOICE_KINDS, invoiceKindOf, invoiceRecordPath, invoiceTitle, type FinanceMoveType } from './invoiceKinds'
import { INVOICE_STATE_TONE, PAYMENT_STATE_TONE, ZATCA_STATE_TONE } from './invoiceTones'

export type Confirmation = 'delete' | 'cancel' | 'reset' | 'debit' | null

/**
 * The state of one document's record page: the loaded record, the heading props of SharedRecordPage (state tags, back
 * link), the actions its state and the caller's capabilities allow, and the handlers behind them. The page owns the
 * SharedRecordPage shell; InvoiceRecordActions, InvoiceRecordBody and InvoiceRecordAside draw its slots from this.
 * Every change waits for the server's answer; a refusal is shown inline in the caller's language.
 */
export function useInvoiceRecord(moveType: FinanceMoveType) {
  const route = useRoute()
  const router = useRouter()
  const { t } = useI18n()
  const { can } = useAccess()
  const hydrated = useHydrated()

  const kind = INVOICE_KINDS[moveType]
  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useFinanceInvoice(computed(() => validId.value ? id.value : null))
  const invoice = computed(() => query.data.value)
  const backTo = computed(() => safeReturnTo(route.query.returnTo, kind.listPath, [kind.listPath]))
  const actions = computed(() => invoice.value ? invoiceActions(invoice.value, can) : null)
  const title = computed(() => invoice.value ? invoiceTitle(invoice.value, t('financeDocuments.draftNumber')) : t(`financeDocuments.kinds.${moveType}.record`))
  const error = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))

  // A document opened under another type's address belongs to that type's pages.
  watch(invoice, record => {
    const own = record && invoiceKindOf(record.move_type)
    if (record && own && own.moveType !== moveType) void router.replace({ path: invoiceRecordPath(record.move_type, record.id), query: route.query })
  })

  const tags = computed<PageHeaderTag[]>(() => {
    const record = invoice.value
    if (!record) return []
    return [
      statusTag({ tone: INVOICE_STATE_TONE[record.state], label: t(`financeDocuments.states.${record.state}`) }, 'finance-invoice-state'),
      ...(record.state === 'posted' ? [statusTag({ tone: PAYMENT_STATE_TONE[record.payment_state], label: t(`financeDocuments.paymentStates.${record.payment_state}`) }, 'finance-invoice-payment-state')] : []),
      ...(record.zatca ? [statusTag({ tone: ZATCA_STATE_TONE[record.zatca.submission.state], label: `${t('financeDocuments.zatca.short')}: ${t(`financeDocuments.zatcaStates.${record.zatca.submission.state}`)}` }, 'finance-invoice-zatca-state')] : []),
      ...(record.partner ? [{ label: record.partner.name, kind: 'person' as const, icon: 'i-lucide-user', testId: 'finance-invoice-partner' }] : []),
    ]
  })

  const editing = ref(false)
  const confirming = ref<Confirmation>(null)
  const debitReason = ref('')
  const debitCopyLines = ref(true)
  const actionError = ref('')
  const zatcaMessages = ref<ReturnType<typeof zatcaSubmissionFromDetails>>(null)

  const transition = useFinanceInvoiceTransition()
  const removal = useDeleteFinanceInvoice()
  const debitNote = useCreateFinanceDebitNote()
  const zatcaSubmit = useFinanceZatcaSubmit()
  const busy = computed(() => transition.isPending.value || removal.isPending.value || debitNote.isPending.value || zatcaSubmit.isPending.value)

  function failure(cause: unknown) {
    if (!(cause instanceof ApiError)) return t('errors.generic')
    const key = financeErrorKey(cause.code)
    return key ? t(key) : cause.message
  }
  async function attempt(work: () => Promise<unknown>) {
    if (!hydrated.value || busy.value) return false
    actionError.value = ''
    zatcaMessages.value = null
    try {
      await work()
      confirming.value = null
      return true
    } catch (cause) {
      actionError.value = failure(cause)
      zatcaMessages.value = cause instanceof ApiError ? zatcaSubmissionFromDetails(cause.details) : null
      return false
    }
  }
  const change = (action: FinanceInvoiceTransition) => attempt(() => transition.mutateAsync({ id: id.value, action }))
  async function remove() {
    if (await attempt(() => removal.mutateAsync(id.value))) await navigateTo(backTo.value, { replace: true })
  }
  async function createDebitNote() {
    const record = invoice.value
    if (!record) return
    let created: { id: number; move_type: typeof record.move_type } | undefined
    const reason = debitReason.value.trim()
    const done = await attempt(async () => {
      created = await debitNote.mutateAsync({ id: record.id, body: { copy_lines: debitCopyLines.value, ...(reason ? { reason } : {}) } })
    })
    if (done && created) await navigateTo({ path: invoiceRecordPath(created.move_type, created.id), query: { returnTo: backTo.value } })
  }
  const sendToZatca = (retry: boolean) => attempt(() => zatcaSubmit.mutateAsync({ id: id.value, retry }))

  const menu = computed(() => {
    const set = actions.value
    if (!set) return []
    return [
      ...(set.debitNote ? [{ label: t('financeDocuments.actions.debitNote'), icon: 'i-lucide-file-plus-2' as const, onSelect: () => { confirming.value = 'debit' } }] : []),
      ...(set.zatcaSubmit ? [{ label: t('financeDocuments.actions.zatcaSubmit'), icon: 'i-lucide-send' as const, onSelect: () => { void sendToZatca(false) } }] : []),
      ...(set.zatcaRetry ? [{ label: t('financeDocuments.actions.zatcaRetry'), icon: 'i-lucide-refresh-cw' as const, onSelect: () => { void sendToZatca(true) } }] : []),
      ...(set.resetToDraft ? [{ label: t('financeDocuments.actions.resetToDraft'), icon: 'i-lucide-undo-2' as const, destructive: true, onSelect: () => { confirming.value = 'reset' } }] : []),
      ...(set.cancel ? [{ label: t('financeDocuments.actions.cancel'), icon: 'i-lucide-ban' as const, destructive: true, onSelect: () => { confirming.value = 'cancel' } }] : []),
      ...(set.delete ? [{ label: t('financeDocuments.actions.delete'), icon: 'i-lucide-trash-2' as const, destructive: true, onSelect: () => { confirming.value = 'delete' } }] : []),
    ]
  })

  return reactive({
    // SharedRecordPage heading props: `v-bind="record.header"`.
    header: reactive({
      keepContent: computed(() => !!invoice.value),
      title,
      description: t(`financeDocuments.kinds.${moveType}.record`),
      tags,
      backTo,
      loading: query.isLoading,
      error,
    }),
    retry: () => { void query.refetch() },
    invoice,
    actions,
    menu,
    title,
    backTo,
    busy,
    hydrated,
    editing,
    confirming,
    debitReason,
    debitCopyLines,
    actionError,
    zatcaMessages,
    paymentTo: computed(() => registerPaymentLink([id.value], route.fullPath)),
    pdfHref: computed(() => `/api/v1/finance/invoices/${id.value}/pdf`),
    debitOriginTo: computed(() => invoice.value?.debit_origin ? { path: invoiceRecordPath(invoice.value.move_type, invoice.value.debit_origin.id), query: { returnTo: backTo.value } } : null),
    posting: transition.isPending,
    removing: removal.isPending,
    creatingDebitNote: debitNote.isPending,
    change,
    remove,
    createDebitNote,
  })
}

export type InvoiceRecordState = ReturnType<typeof useInvoiceRecord>
