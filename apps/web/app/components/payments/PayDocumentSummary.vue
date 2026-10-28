<script setup lang="ts">
import type { PayDocumentKind } from '@webvue/contracts'
import { formatPayAmount, payDeadline, type PayableDocument } from '@/composables/paymentPay'

// What the payer sees of an invoice or an online order: the amount due, who it is owed to, its number and its deadline
// (an invoice's due date, the moment an unpaid order expires). The contract carries no partner data, so there is none to show.
const props = defineProps<{ kind: PayDocumentKind; payable: PayableDocument }>()
const { t, locale } = useI18n()
const deadline = computed(() => payDeadline(props.payable, locale.value))
</script>

<template>
  <div class="grid gap-4">
    <SharedSubCard tone="tinted" class="grid gap-1 text-center">
      <span class="text-sm text-muted">{{ t('payments.pay.amountDue') }}</span>
      <bdi dir="ltr" class="text-2xl font-semibold text-highlighted tabular-nums" data-testid="pay-amount-due">{{ formatPayAmount(payable.amount_due, payable.currency) }} <span class="text-base font-normal text-muted">{{ payable.currency }}</span></bdi>
    </SharedSubCard>
    <dl class="divide-y divide-default">
      <SharedPropertyRow :label="t('payments.pay.merchant')" :value="payable.merchant" data-testid="pay-merchant" />
      <SharedPropertyRow :label="t(`payments.pay.${kind}.number`)" data-testid="pay-number"><bdi dir="ltr">{{ payable.number }}</bdi></SharedPropertyRow>
      <SharedPropertyRow :label="t(`payments.pay.${kind}.deadline`)" :value="deadline" :data-testid="kind === 'order' ? 'pay-expires-at' : 'pay-due-date'" />
      <SharedPropertyRow v-if="payable.amount_total !== payable.amount_due" :label="t(`payments.pay.${kind}.total`)" data-testid="pay-total">
        <bdi dir="ltr" class="tabular-nums">{{ formatPayAmount(payable.amount_total, payable.currency) }} {{ payable.currency }}</bdi>
      </SharedPropertyRow>
    </dl>
  </div>
</template>
