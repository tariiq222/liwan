import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { statusTag, type PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import { useFinanceBankStatement } from '@/composables/finance/useFinanceBank'
import { BANK_LINE_TONE, BANK_STATEMENTS_PATH, statementSummary } from './bankModel'

/**
 * The state of one statement's record page: the loaded statement (it carries every line), its figures, the heading props
 * of SharedRecordPage (tags, back link to the list with its query). The page owns the SharedRecordPage shell;
 * BankStatementBody and BankStatementAside draw its slots from this.
 */
export function useBankStatementRecord() {
  const route = useRoute()
  const { t } = useI18n()
  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useFinanceBankStatement(computed(() => validId.value ? id.value : null))
  const statement = computed(() => query.data.value)
  const summary = computed(() => statement.value ? statementSummary(statement.value) : null)
  const backTo = computed(() => safeReturnTo(route.query.returnTo, BANK_STATEMENTS_PATH, [BANK_STATEMENTS_PATH]))
  const error = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))

  const tags = computed<PageHeaderTag[]>(() => {
    const record = statement.value
    const figures = summary.value
    if (!record || !figures) return []
    const state = figures.fullyReconciled ? 'reconciled' : 'open'
    return [
      { label: record.journal.name, kind: 'category', icon: 'i-lucide-landmark', testId: 'finance-bank-journal' },
      { label: t('financeBank.linesCount', { count: record.lines_count }, record.lines_count), kind: 'count', testId: 'finance-bank-lines-count' },
      statusTag({ tone: BANK_LINE_TONE[state], label: t(`financeBank.statementStates.${state}`) }, 'finance-bank-state'),
    ]
  })

  const editing = ref(false)
  const deleting = ref(false)

  return reactive({
    // SharedRecordPage heading props: `v-bind="record.header"`.
    header: reactive({
      keepContent: computed(() => !!statement.value),
      title: computed(() => statement.value?.name ?? t('financeBank.recordKind')),
      tags,
      backTo,
      loading: query.isLoading,
      error,
    }),
    retry: () => { void query.refetch() },
    id,
    editing,
    deleting,
    statement,
    summary,
    backTo,
  })
}

export type BankStatementRecordState = ReturnType<typeof useBankStatementRecord>
