<script setup lang="ts">
import type { FinanceBankStatementDetail } from '@liwan/contracts'
import { usePatchFinanceBankStatement } from '@/composables/finance/useFinanceBank'
import { financeErrorMessage } from '../financeErrors'
import { bankErrorKey } from './bankErrors'
import { statementEditDraft, statementPatch, validateStatementEdit } from './bankStatementEdit'

// Corrects a statement's name and the balances the bank printed. The lines are not edited here: a wrong line is fixed by
// removing the statement (once nothing is reconciled) and importing it again. A locked period refuses the change.
const props = defineProps<{ statement: FinanceBankStatementDetail }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const patch = usePatchFinanceBankStatement()
const draft = reactive(statementEditDraft(props.statement))
const attempted = ref(false)
const error = ref('')
const errors = computed(() => validateStatementEdit(draft))
const shown = computed(() => attempted.value ? errors.value : {})

async function submit() {
  if (!hydrated.value || patch.isPending.value) return
  attempted.value = true
  error.value = ''
  if (Object.keys(errors.value).length) return
  const body = statementPatch(props.statement, draft)
  if (!body) { emit('done'); return }
  try {
    await patch.mutateAsync({ id: props.statement.id, body })
    emit('done')
  } catch (cause) {
    error.value = financeErrorMessage(cause, bankErrorKey, t)
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="liwan-form rounded-card border border-default p-(--liwan-card-pad-dense)" method="post" data-testid="finance-bank-edit-form" @submit="submit">
    <p class="font-semibold text-highlighted">{{ t('financeBank.edit.title') }}</p>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-bank-edit-error" />
    <div class="liwan-form-grid">
      <UFormField :label="t('financeBank.form.name')" name="finance-bank-edit-name" required class="sm:col-span-2" :error="shown.name ? t('financeBank.form.nameInvalid') : undefined">
        <UInput id="finance-bank-edit-name" v-model="draft.name" class="w-full" maxlength="120" :disabled="!hydrated || patch.isPending.value" />
      </UFormField>
      <UFormField :label="t('financeBank.form.balanceStart')" name="finance-bank-edit-start" required :error="shown.balanceStart ? t('financeBank.form.numberInvalid') : undefined">
        <UInput id="finance-bank-edit-start" v-model="draft.balanceStart" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || patch.isPending.value" />
      </UFormField>
      <UFormField :label="t('financeBank.form.balanceEndReal')" name="finance-bank-edit-end" required :error="shown.balanceEnd ? t('financeBank.form.numberInvalid') : undefined">
        <UInput id="finance-bank-edit-end" v-model="draft.balanceEnd" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || patch.isPending.value" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="patch.isPending.value" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated" :loading="patch.isPending.value" :label="t('app.save')" data-testid="finance-bank-edit-save" />
    </div>
  </UForm>
</template>
