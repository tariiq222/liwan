<script setup lang="ts">
import { SALES_PREPAYMENT_PERCENT, type SalesPaymentToConfirm } from '@liwan/contracts'
import type { SalesPaymentDraft } from '@/composables/sales/salesOrderDraft'

// How one quotation asks to be paid: not at all, all of it, or a percentage of it. It is shown only while the tenant can
// take payments; the quotation starts with the tenant's default, and what is chosen here is what counts after that.
const props = defineProps<{ modelValue: SalesPaymentDraft; disabled?: boolean; percentError?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: SalesPaymentDraft] }>()
const { t } = useI18n()

const MODES: SalesPaymentToConfirm[] = ['off', 'full', 'percent']
const items = computed(() => MODES.map(value => ({ value, label: t(`sales.form.payment.${value}`), description: t(`sales.form.payment.${value}Hint`) })))
const mode = computed({ get: () => props.modelValue.mode, set: value => emit('update:modelValue', { ...props.modelValue, mode: value }) })
const percent = computed({ get: () => props.modelValue.percent, set: value => emit('update:modelValue', { ...props.modelValue, percent: value }) })
</script>

<template>
  <div class="grid gap-4" data-testid="sales-payment-choice">
    <SharedOptionCards v-model="mode" :options="items" :disabled="props.disabled" :label="t('sales.form.payment.title')" data-testid="sales-payment-mode-choice" />
    <UFormField v-if="mode === 'percent'" :label="t('sales.form.payment.shareLabel')" :help="t('sales.form.payment.shareHint')" :error="props.percentError">
      <UInputNumber v-model="percent" class="w-full" :min="SALES_PREPAYMENT_PERCENT.min" :max="SALES_PREPAYMENT_PERCENT.max" :step="1" :disabled="props.disabled" data-testid="sales-payment-percent" />
    </UFormField>
  </div>
</template>
