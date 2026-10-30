<script setup lang="ts">
import type { FinanceBudgetDetail } from '@liwan/contracts'
import { useFinanceAnalyticAccounts } from '@/composables/finance/useFinanceAnalytic'
import { useDistributeFinanceBudget } from '@/composables/finance/useFinanceBudgets'
import AccountPicker from '../AccountPicker.vue'
import { financeErrorMessage } from '../financeErrors'
import Money from '../invoices/Money.vue'
import { budgetErrorKey } from './budgetErrors'
import { buildDistribute, emptyDistribute, evenPercents, hasDistributeErrors, percentTotal, shareAmount, validateDistribute, type DistributeDraft } from './budgetDistribute'

// Splits one account's budget for a period between cost centers: one line each, the percents adding up to 100 and each cost
// center named once. Saving switches the budget's cost center split on, so lines of one account may then share a period.
const props = defineProps<{ budget: FinanceBudgetDetail }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const distribute = useDistributeFinanceBudget()
const centers = useFinanceAnalyticAccounts({ archived: 'false', limit: 100, offset: 0 })
const centerItems = computed(() => (centers.data.value?.items ?? []).map(center => ({ value: center.id, label: center.name })))

const draft = reactive<DistributeDraft>(emptyDistribute())
const attempted = ref(false)
const error = ref('')
const errors = computed(() => validateDistribute(draft))
const shown = computed(() => attempted.value ? errors.value : null)
const total = computed(() => percentTotal(draft.shares))
const pending = computed(() => distribute.isPending.value)

function addShare() { draft.shares.push({ analyticId: null, percent: '' }) }
function removeShare(index: number) { if (draft.shares.length > 2) draft.shares.splice(index, 1) }
function splitEvenly() { evenPercents(draft.shares.length).forEach((percent, index) => { draft.shares[index]!.percent = percent }) }

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (hasDistributeErrors(errors.value)) return
  try {
    await distribute.mutateAsync({ id: props.budget.id, body: buildDistribute(draft) })
    emit('done')
  } catch (cause) {
    error.value = financeErrorMessage(cause, budgetErrorKey, t)
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="grid gap-4 border-t border-default p-(--liwan-card-pad)" method="post" data-testid="finance-budget-distribute-form" @submit="submit">
    <h3 class="text-sm font-semibold text-highlighted">{{ t('financeBudgets.distribute.title') }}</h3>
    <p class="text-sm text-muted">{{ t('financeBudgets.distribute.hint') }}</p>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-budget-distribute-error" />
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('financeBudgets.lines.account')" name="finance-budget-distribute-account" required :error="shown?.account ? t('financeBudgets.lines.accountRequired') : undefined">
        <AccountPicker v-model="draft.accountId" :disabled="pending" :invalid="!!shown?.account" :aria-label="t('financeBudgets.lines.account')" />
      </UFormField>
      <UFormField :label="t('financeBudgets.distribute.amount')" name="finance-budget-distribute-amount" required :error="shown?.amount ? t('financeBudgets.lines.amountInvalid') : undefined">
        <UInput id="finance-budget-distribute-amount" v-model="draft.amount" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('financeBudgets.form.dateFrom')" name="finance-budget-distribute-from">
        <SharedDateField id="finance-budget-distribute-from" v-model="draft.dateFrom" :min-value="budget.date_from" :max-value="draft.dateTo ?? budget.date_to" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('financeBudgets.form.dateTo')" name="finance-budget-distribute-to" :error="shown?.order ? t('financeBudgets.form.periodOrder') : undefined">
        <SharedDateField id="finance-budget-distribute-to" v-model="draft.dateTo" :min-value="draft.dateFrom ?? budget.date_from" :max-value="budget.date_to" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('financeBudgets.lines.label')" name="finance-budget-distribute-label" class="sm:col-span-2">
        <UInput id="finance-budget-distribute-label" v-model="draft.label" class="w-full" maxlength="255" :disabled="!hydrated || pending" />
      </UFormField>
    </div>
    <fieldset class="grid gap-3" :aria-describedby="shown?.shares || shown?.total ? 'finance-budget-distribute-shares-error' : undefined">
      <legend class="text-sm font-medium text-highlighted">{{ t('financeBudgets.distribute.shares') }}</legend>
      <div v-for="(share, index) in draft.shares" :key="index" class="grid grid-cols-[1fr_7rem_auto] items-end gap-2" :data-testid="`finance-budget-share-${index}`">
        <UFormField :label="t('financeBudgets.distribute.costCenter')" :name="`finance-budget-share-center-${index}`">
          <USelect :model-value="share.analyticId ?? undefined" :items="centerItems" class="w-full" :placeholder="t('financeBudgets.distribute.pickCenter')" :disabled="!hydrated || pending" @update:model-value="value => { share.analyticId = Number(value) }" />
        </UFormField>
        <UFormField :label="t('financeBudgets.distribute.percent')" :name="`finance-budget-share-percent-${index}`" :help="shareAmount(draft.amount, share.percent) !== null ? undefined : ' '">
          <UInput v-model="share.percent" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || pending" />
        </UFormField>
        <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" :disabled="draft.shares.length <= 2 || pending" :aria-label="t('financeBudgets.distribute.removeShare', { number: index + 1 })" @click="removeShare(index)" />
        <p v-if="shareAmount(draft.amount, share.percent) !== null" class="col-span-3 -mt-1 text-xs text-muted"><Money :amount="shareAmount(draft.amount, share.percent)!" :currency="budget.currency" /></p>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="flex items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!hydrated || pending || draft.shares.length >= 50" :label="t('financeBudgets.distribute.addShare')" @click="addShare" />
          <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="!hydrated || pending" :label="t('financeBudgets.distribute.splitEvenly')" @click="splitEvenly" />
        </span>
        <span class="text-sm" :class="total === 100 ? 'text-success' : 'text-warning'" data-testid="finance-budget-distribute-total">{{ t('financeBudgets.distribute.total', { percent: total }) }}</span>
      </div>
      <p v-if="shown?.shares || shown?.total" id="finance-budget-distribute-shares-error" role="alert" class="text-sm text-error">{{ t(shown?.shares ? 'financeBudgets.distribute.sharesInvalid' : 'financeBudgets.distribute.totalInvalid') }}</p>
    </fieldset>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t('financeBudgets.distribute.submit')" data-testid="finance-budget-distribute-submit" />
    </div>
  </UForm>
</template>
