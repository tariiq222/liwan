<script setup lang="ts">
import type { FinanceBudgetDetail } from '@webvue/contracts'
import { useCreateFinanceBudgetLine } from '@/composables/finance/useFinanceBudgets'
import AccountPicker from '../AccountPicker.vue'
import { financeErrorMessage } from '../financeErrors'
import { budgetErrorKey } from './budgetErrors'
import { buildBudgetLine, emptyBudgetLine, hasBudgetLineErrors, validateBudgetLine, type BudgetLineDraft } from './budgetLineDraft'

// The inline form that adds one line to a draft budget. The period is optional (it defaults to the budget's) and
// stays inside the budget's own; the form empties after a saved line so the next one can follow.
const props = defineProps<{ budget: FinanceBudgetDetail }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateFinanceBudgetLine()

const draft = reactive<BudgetLineDraft>(emptyBudgetLine())
const attempted = ref(false)
const error = ref('')
const errors = computed(() => validateBudgetLine(draft))
const shown = computed(() => attempted.value ? errors.value : null)
const pending = computed(() => create.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (hasBudgetLineErrors(errors.value)) return
  try {
    await create.mutateAsync({ id: props.budget.id, body: buildBudgetLine(draft) })
    Object.assign(draft, emptyBudgetLine())
    attempted.value = false
  } catch (cause) {
    error.value = financeErrorMessage(cause, budgetErrorKey, t)
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="grid gap-4 border-t border-default p-(--webvue-card-pad)" method="post" data-testid="finance-budget-line-form" @submit="submit">
    <h3 class="text-sm font-semibold text-highlighted">{{ t('financeBudgets.lines.add') }}</h3>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-budget-line-error" />
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('financeBudgets.lines.account')" name="finance-budget-line-account" required :error="shown?.account ? t('financeBudgets.lines.accountRequired') : undefined">
        <AccountPicker v-model="draft.accountId" :disabled="pending" :invalid="!!shown?.account" :aria-label="t('financeBudgets.lines.account')" />
      </UFormField>
      <UFormField :label="t('financeBudgets.lines.amount')" name="finance-budget-line-amount" required :error="shown?.amount ? t('financeBudgets.lines.amountInvalid') : undefined">
        <UInput id="finance-budget-line-amount" v-model="draft.amount" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :color="shown?.amount ? 'error' : undefined" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('financeBudgets.lines.label')" name="finance-budget-line-label" class="sm:col-span-2">
        <UInput id="finance-budget-line-label" v-model="draft.label" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('financeBudgets.form.dateFrom')" name="finance-budget-line-from">
        <SharedDateField id="finance-budget-line-from" v-model="draft.dateFrom" :min-value="budget.date_from" :max-value="draft.dateTo ?? budget.date_to" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('financeBudgets.form.dateTo')" name="finance-budget-line-to" :error="shown?.order ? t('financeBudgets.form.periodOrder') : undefined">
        <SharedDateField id="finance-budget-line-to" v-model="draft.dateTo" :min-value="draft.dateFrom ?? budget.date_from" :max-value="budget.date_to" :disabled="!hydrated || pending" />
      </UFormField>
    </div>
    <div>
      <UButton type="submit" color="primary" variant="outline" icon="i-lucide-plus" :disabled="!hydrated || pending" :loading="pending" :label="t('financeBudgets.lines.addSubmit')" data-testid="finance-budget-line-submit" />
    </div>
  </UForm>
</template>
