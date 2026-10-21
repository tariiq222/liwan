<script setup lang="ts">
import type { FinancePayment } from '@webvue/contracts'
import { useFinancePaymentJournals, usePatchFinancePayment } from '@/composables/finance/useFinancePayments'
import { financeErrorMessage } from '../financeErrors'
import { financeErrorKey } from '../invoices/invoiceErrors'
import { paymentEditDraft, paymentPatch, validatePaymentEdit } from './paymentEdit'

// Edits a draft payment inline (the party and the direction are fixed; to change them, cancel it and register another).
const props = defineProps<{ payment: FinancePayment }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const patch = usePatchFinancePayment()
const journals = useFinancePaymentJournals()
const draft = reactive(paymentEditDraft(props.payment))
const attempted = ref(false)
const error = ref('')
const errors = computed(() => validatePaymentEdit(draft))
const shown = computed(() => attempted.value ? errors.value : {})
const journalItems = computed(() => (journals.data.value ?? []).map(journal => ({ value: journal.id, label: `${journal.name} (${journal.currency})` })))

async function submit() {
  if (!hydrated.value || patch.isPending.value) return
  attempted.value = true
  error.value = ''
  if (Object.keys(errors.value).length) return
  const body = paymentPatch(props.payment, draft)
  if (!body) { emit('done'); return }
  try {
    await patch.mutateAsync({ id: props.payment.id, body })
    emit('done')
  } catch (cause) {
    error.value = financeErrorMessage(cause, financeErrorKey, t)
  }
}
</script>

<template>
  <UForm novalidate :state="draft" class="webvue-form rounded-card border border-default p-(--webvue-card-pad-dense)" method="post" data-testid="finance-payment-edit-form" @submit="submit">
    <p class="font-semibold text-highlighted">{{ t('financeDocuments.payments.edit.title', { name: payment.name ?? `#${payment.id}` }) }}</p>
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" data-testid="finance-payment-edit-error" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeDocuments.payments.amount')" name="finance-payment-edit-amount" required :error="shown.amount ? t('financeDocuments.payments.form.amountRequired') : undefined">
        <UInput id="finance-payment-edit-amount" v-model="draft.amount" type="number" min="0" step="any" inputmode="decimal" class="w-full tabular-nums" :disabled="!hydrated || patch.isPending.value" />
      </UFormField>
      <UFormField :label="t('financeDocuments.payments.form.date')" name="finance-payment-edit-date" required :error="shown.paymentDate ? t('financeDocuments.payments.form.dateRequired') : undefined">
        <SharedDateField id="finance-payment-edit-date" v-model="draft.paymentDate" :disabled="!hydrated || patch.isPending.value" />
      </UFormField>
      <UFormField :label="t('financeDocuments.payments.form.journal')" name="finance-payment-edit-journal" required>
        <USelect id="finance-payment-edit-journal" :model-value="draft.journalId ?? undefined" :items="journalItems" class="w-full" :disabled="!hydrated || patch.isPending.value" @update:model-value="value => { draft.journalId = Number(value) }" />
      </UFormField>
      <UFormField :label="t('financeDocuments.payments.form.memo')" name="finance-payment-edit-memo">
        <UInput id="finance-payment-edit-memo" v-model="draft.memo" class="w-full" maxlength="255" :disabled="!hydrated || patch.isPending.value" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="patch.isPending.value" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated" :loading="patch.isPending.value" :label="t('app.save')" data-testid="finance-payment-edit-save" />
    </div>
  </UForm>
</template>
