<script setup lang="ts">
import type { PayableInvoice } from '@webvue/contracts'
import { formatPayAmount, formatPayDate } from '@/composables/paymentPay'

// What the payer sees of an invoice: the amount due, who it is owed to, the invoice number and its due date.
// The contract carries no partner data, so there is none to show.
defineProps<{ invoice: PayableInvoice }>()
const { t, locale } = useI18n()
</script>

<template>
  <div class="grid gap-4">
    <SharedSubCard tone="tinted" class="grid gap-1 text-center">
      <span class="text-sm text-muted">{{ t('payments.pay.amountDue') }}</span>
      <bdi dir="ltr" class="text-2xl font-semibold text-highlighted tabular-nums" data-testid="pay-amount-due">{{ formatPayAmount(invoice.amount_due, invoice.currency) }} <span class="text-base font-normal text-muted">{{ invoice.currency }}</span></bdi>
    </SharedSubCard>
    <dl class="divide-y divide-default">
      <SharedPropertyRow :label="t('payments.pay.merchant')" :value="invoice.merchant" data-testid="pay-merchant" />
      <SharedPropertyRow :label="t('payments.pay.number')" data-testid="pay-number"><bdi dir="ltr">{{ invoice.number }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t('payments.pay.dueDate')" :value="invoice.due_date ? formatPayDate(invoice.due_date, locale) : null" data-testid="pay-due-date" />
      <SharedPropertyRow v-if="invoice.amount_total !== invoice.amount_due" :label="t('payments.pay.total')" data-testid="pay-total">
        <bdi dir="ltr" class="tabular-nums">{{ formatPayAmount(invoice.amount_total, invoice.currency) }} {{ invoice.currency }}</bdi>
      </SharedPropertyRow>
    </dl>
  </div>
</template>
