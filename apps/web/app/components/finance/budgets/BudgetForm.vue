<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { useCreateFinanceBudget } from '@/composables/finance/useFinanceBudgets'
import { financeErrorMessage } from '../financeErrors'
import { budgetErrorKey } from './budgetErrors'
import {
  budgetDraftDirty,
  buildBudgetCreate,
  emptyBudgetDraft,
  hasBudgetErrors,
  validateBudgetDraft,
  type BudgetFormDraft,
} from './budgetDraft'

// The form of a new budget: its name, description and period. The lines are added on the record, once it exists.
defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateFinanceBudget()

const draft = reactive<BudgetFormDraft>(emptyBudgetDraft())
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const dirty = computed(() => !saved.value && budgetDraftDirty(draft))
const errors = computed(() => validateBudgetDraft(draft))
const shown = computed(() => attempted.value ? errors.value : null)
const pending = computed(() => create.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  if (hasBudgetErrors(errors.value)) return
  try {
    const record = await create.mutateAsync(buildBudgetCreate(draft))
    saved.value = true
    await nextTick()
    emit('saved', record.id)
  } catch (cause) {
    error.value = financeErrorMessage(cause, budgetErrorKey, t)
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="draft" class="webvue-form" method="post" data-testid="finance-budget-form" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-budget-form-error" />
    <SharedFormSection panel :title="t('financeBudgets.form.details')">
      <div class="grid gap-4">
        <UFormField :label="t('financeBudgets.form.name')" name="finance-budget-name" required :error="shown?.name ? t('financeBudgets.form.nameRequired') : undefined">
          <UInput id="finance-budget-name" v-model="draft.name" class="w-full" maxlength="255" :color="shown?.name ? 'error' : undefined" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('financeBudgets.form.description')" name="finance-budget-description">
          <UTextarea id="finance-budget-description" v-model="draft.description" class="w-full" :rows="3" maxlength="255" :disabled="!hydrated || pending" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('financeBudgets.form.dateFrom')" name="finance-budget-from" required :error="shown?.dateFrom ? t('financeBudgets.form.dateRequired') : undefined">
            <SharedDateField id="finance-budget-from" v-model="draft.dateFrom" :max-value="draft.dateTo" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField :label="t('financeBudgets.form.dateTo')" name="finance-budget-to" required :error="shown?.dateTo ? t('financeBudgets.form.dateRequired') : shown?.order ? t('financeBudgets.form.periodOrder') : undefined">
            <SharedDateField id="finance-budget-to" v-model="draft.dateTo" :min-value="draft.dateFrom" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <UFormField name="finance-budget-split" :help="t('financeBudgets.form.costCenterSplitHelp')">
          <UCheckbox v-model="draft.costCenterSplit" :label="t('financeBudgets.form.costCenterSplit')" :disabled="!hydrated || pending" data-testid="finance-budget-split" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('financeBudgets.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t('financeBudgets.form.createDraft')" data-testid="finance-budget-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
