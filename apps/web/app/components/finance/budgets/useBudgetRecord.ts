import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { statusTag, type PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import {
  useFinanceBudget,
  useFinanceBudgetTransition,
  type FinanceBudgetTransition,
} from '@/composables/finance/useFinanceBudgets'
import { financeErrorMessage } from '../financeErrors'
import { offeredMenuItems, readFinanceActions } from '../financeActions'
import { budgetErrorKey } from './budgetErrors'
import { BUDGETS_PATH, budgetPeriod } from './budgetPaths'
import { BUDGET_STATE_TONE } from './budgetTones'

export type BudgetConfirmation = 'confirm' | 'reset' | 'cancel'

const TRANSITION_OF = { confirm: 'confirm', reset: 'reset-to-draft', cancel: 'cancel' } as const satisfies Record<BudgetConfirmation, FinanceBudgetTransition>
const CONFIRM_COLOR = { confirm: 'primary', reset: 'warning', cancel: 'error' } as const satisfies Record<BudgetConfirmation, string>

/**
 * The state of one budget's record page: the loaded record, the heading props of SharedRecordPage (state, period and
 * currency tags, back link), the actions its state and the caller's capabilities allow, and the one confirmation open
 * at a time. The page owns the SharedRecordPage shell; BudgetRecordActions, BudgetRecordBody and BudgetRecordAside
 * draw its slots from this. Every change waits for the server's answer; a refusal is shown inline in the caller's
 * language.
 */
export function useBudgetRecord() {
  const route = useRoute()
  const { t } = useI18n()
  const hydrated = useHydrated()

  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useFinanceBudget(computed(() => validId.value ? id.value : null))
  const budget = computed(() => query.data.value)
  const backTo = computed(() => safeReturnTo(route.query.returnTo, BUDGETS_PATH, [BUDGETS_PATH]))
  const actions = computed(() => budget.value ? readFinanceActions(budget.value) : null)
  const title = computed(() => budget.value?.name ?? t('financeBudgets.budgets.record'))
  const error = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))

  const tags = computed<PageHeaderTag[]>(() => {
    const record = budget.value
    if (!record) return []
    return [
      statusTag({ tone: BUDGET_STATE_TONE[record.state], label: t(`financeBudgets.states.${record.state}`) }, 'finance-budget-state'),
      { label: budgetPeriod(record), kind: 'schedule', icon: 'i-lucide-calendar-range', testId: 'finance-budget-period' },
      { label: record.currency, kind: 'category', icon: 'i-lucide-banknote', testId: 'finance-budget-currency' },
    ]
  })

  const confirming = ref<BudgetConfirmation | null>(null)
  const actionError = ref('')
  const transition = useFinanceBudgetTransition()
  const busy = computed(() => transition.isPending.value)

  async function applyConfirmation() {
    const kind = confirming.value
    if (!kind || !hydrated.value || busy.value) return
    actionError.value = ''
    try {
      await transition.mutateAsync({ id: id.value, action: TRANSITION_OF[kind] })
      confirming.value = null
    } catch (cause) {
      actionError.value = financeErrorMessage(cause, budgetErrorKey, t)
    }
  }

  function ask(kind: BudgetConfirmation) { confirming.value = kind }
  const menu = computed(() => {
    const set = actions.value
    if (!set) return []
    return offeredMenuItems(set, [
      ['reset_to_draft', { label: t('financeBudgets.actions.reset'), icon: 'i-lucide-undo-2', onSelect: () => ask('reset') }],
      ['cancel', { label: t('financeBudgets.actions.cancel'), icon: 'i-lucide-circle-x', destructive: true, onSelect: () => ask('cancel') }],
    ])
  })

  // The text and look of the open confirmation, so the page draws one SharedInlineConfirm for all three actions.
  const confirmation = computed(() => {
    const kind = confirming.value
    if (!kind) return null
    return {
      title: t(`financeBudgets.confirm.${kind}`, { name: title.value }),
      description: t(`financeBudgets.confirm.${kind}Hint`),
      confirmLabel: t(`financeBudgets.actions.${kind}`),
      color: CONFIRM_COLOR[kind],
    }
  })

  return reactive({
    // SharedRecordPage heading props: `v-bind="record.header"`.
    header: reactive({
      keepContent: computed(() => !!budget.value),
      title,
      tags,
      backTo,
      loading: query.isLoading,
      error,
    }),
    retry: () => { void query.refetch() },
    id,
    budget,
    actions,
    menu,
    title,
    busy,
    hydrated,
    confirming,
    confirmation,
    actionError,
    ask,
    applyConfirmation,
  })
}

export type BudgetRecordState = ReturnType<typeof useBudgetRecord>
