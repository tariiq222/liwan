<script setup lang="ts">
import { HrPayrollPaymentCreateSchema, type HrPayrollPaymentCreate, type HrRef } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { payrollErrorMessage } from '@/utils/payrollErrors'

// The payment of a posted run, asked inline: the bank or cash journal it is paid from and the payment date. The
// confirmation is the form's own button, so nothing is sent before the user confirms. The server's refusal (a locked
// period on the date, a journal it rejects) is shown under the field it names. Not printed.
const props = defineProps<{
  /** The bank and cash journals; empty when the user cannot read journals. */
  journals: HrRef[]
  pending: boolean
  /** The refusal of the last attempt, or null. */
  error: unknown
  /** The date the field starts with (`YYYY-MM-DD`). */
  defaultDate: string
}>()
const emit = defineEmits<{ submit: [body: HrPayrollPaymentCreate]; cancel: [] }>()

const { t } = useI18n()

const journal = ref<string | undefined>(undefined)
const date = ref<string | null>(props.defaultDate)
const body = computed(() => HrPayrollPaymentCreateSchema.safeParse({ journal_id: Number(journal.value), date: date.value }))
const items = computed(() => props.journals.map(item => ({ value: String(item.id), label: item.name })))

const serverField = computed(() => props.error instanceof ApiError ? props.error.field : undefined)
const fieldError = (field: string) => {
  if (!props.error || serverField.value !== field) return undefined
  return props.error instanceof ApiError && props.error.code === 'period_locked' ? t('hrPayroll.finance.payment.periodLocked') : payrollErrorMessage(props.error, t, new Map())
}

function submitPayment() {
  if (props.pending || !body.value.success) return
  emit('submit', body.value.data)
}
</script>

<template>
  <SharedInlineConfirm
    color="primary"
    :title="t('hrPayroll.actions.paymentTitle')"
    :description="t('hrPayroll.actions.paymentHint')"
    :confirm-label="t('hrPayroll.finance.payment.confirm')"
    :pending="props.pending"
    :disabled="!body.success"
    data-testid="hr-payroll-payment-form"
    @confirm="submitPayment"
    @cancel="emit('cancel')"
  >
    <p v-if="props.journals.length === 0" class="mt-2 text-sm" data-testid="hr-payroll-payment-no-journals">{{ t('hrPayroll.finance.payment.noJournals') }}</p>
    <div v-else class="webvue-form-grid mt-3">
      <UFormField :label="t('hrPayroll.finance.payment.journal')" name="hr-payroll-payment-journal" required :error="fieldError('journal_id')">
        <USelect id="hr-payroll-payment-journal" v-model="journal" class="w-full" :items="items" :placeholder="t('hrPayroll.finance.payment.journalPlaceholder')" :disabled="props.pending" data-testid="hr-payroll-payment-journal" />
      </UFormField>
      <UFormField :label="t('hrPayroll.finance.payment.date')" name="hr-payroll-payment-date" required :error="fieldError('date')">
        <SharedDateField id="hr-payroll-payment-date" v-model="date" :disabled="props.pending" :aria-label="t('hrPayroll.finance.payment.date')" data-testid="hr-payroll-payment-date" />
      </UFormField>
    </div>
  </SharedInlineConfirm>
</template>
