import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { ApiError } from '@/composables/useApi'
import { useFinanceBankStatement, useFinanceReconcileProposals, useReconcileFinanceBankLine } from '@/composables/finance/useFinanceBank'
import { financeErrorMessage } from '../financeErrors'
import { bankErrorKey } from './bankErrors'
import { BANK_STATEMENTS_PATH, sameMoney, statementPath } from './bankModel'
import { buildReconcileBody, remainingDifference, selectedTotal } from './reconcileModel'

/**
 * The state of one statement line's reconciliation page: the line (read from its statement), the open items it can be
 * matched with, the ticked items, the difference that remains and the account that takes it. Reconciling waits for the
 * server's answer and returns to the statement; a refusal is shown inline in the caller's language.
 */
export function useBankReconcilePage() {
  const route = useRoute()
  const { t } = useI18n()
  const { can } = useAccess()
  const hydrated = useHydrated()

  const statementId = computed(() => Number(route.params.id))
  const lineId = computed(() => Number(route.params.lineId))
  const validIds = computed(() => [statementId.value, lineId.value].every(value => Number.isSafeInteger(value) && value > 0))
  const allowed = computed(() => can('finance.bank.manage'))
  const statementQuery = useFinanceBankStatement(computed(() => validIds.value ? statementId.value : null))
  const statement = computed(() => statementQuery.data.value)
  const line = computed(() => statement.value?.lines.find(item => item.id === lineId.value) ?? null)
  const open = computed(() => !!line.value && !line.value.is_reconciled)
  const proposalsQuery = useFinanceReconcileProposals(computed(() => validIds.value ? lineId.value : null), computed(() => open.value && allowed.value))
  const proposals = computed(() => proposalsQuery.data.value?.items ?? [])

  const listLocation = computed(() => safeReturnTo(route.query.returnTo, BANK_STATEMENTS_PATH, [BANK_STATEMENTS_PATH]))
  const backTo = computed(() => ({ path: statementPath(statementId.value), query: { returnTo: listLocation.value } }))
  const notFound = computed(() => validIds.value ? !!statement.value && !line.value : true)
  const error = computed(() => statementQuery.error.value ?? (notFound.value ? new ApiError(404, 'not_found', t('errors.generic')) : null))

  const selected = ref<number[]>([])
  const writeOff = reactive({ accountId: null as number | null, label: '' })
  const confirming = ref(false)
  const actionError = ref('')
  const reconcile = useReconcileFinanceBankLine()

  const selectedSum = computed(() => selectedTotal(proposals.value, selected.value))
  const difference = computed(() => remainingDifference(line.value?.amount_residual ?? 0, selectedSum.value))
  const balanced = computed(() => sameMoney(difference.value, 0))
  const body = computed(() => buildReconcileBody(selected.value, difference.value, writeOff))
  const pending = computed(() => reconcile.isPending.value)

  async function submit() {
    if (!hydrated.value || pending.value || !body.value) return
    actionError.value = ''
    try {
      await reconcile.mutateAsync({ lineId: lineId.value, body: body.value })
      await navigateTo(backTo.value, { replace: true })
    } catch (cause) {
      confirming.value = false
      actionError.value = financeErrorMessage(cause, bankErrorKey, t)
    }
  }

  return reactive({
    // SharedRecordPage heading props: `v-bind="page.header"`.
    header: reactive({
      keepContent: computed(() => !!line.value),
      title: computed(() => line.value?.payment_ref ?? t('financeBank.reconcile.title')),
      description: computed(() => statement.value?.name ?? t('financeBank.reconcile.title')),
      backTo,
      backLabel: t('financeBank.reconcile.backToStatement'),
      loading: statementQuery.isLoading,
      error,
    }),
    retry: () => { void statementQuery.refetch() },
    allowed,
    statement,
    line,
    open,
    proposalsQuery,
    proposals,
    selected,
    selectedSum,
    difference,
    balanced,
    writeOff,
    body,
    confirming,
    actionError,
    pending,
    hydrated,
    submit,
  })
}

export type BankReconcileState = ReturnType<typeof useBankReconcilePage>
