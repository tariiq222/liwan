<script setup lang="ts">
import type { FinancePayment } from '@liwan/contracts'
import Money from '../invoices/Money.vue'
import { exchangeOutcome } from './paymentModel'

// The exchange gain or loss, in the company currency, that settling foreign-currency items produced; nothing when there was none.
const props = defineProps<{ payment: Pick<FinancePayment, 'id' | 'exchange_difference'> }>()
const { t } = useI18n()
const outcome = computed(() => exchangeOutcome(props.payment))
</script>

<template>
  <p v-if="outcome" class="text-xs" :class="outcome.kind === 'gain' ? 'text-success' : 'text-error'" :data-testid="`finance-payment-exchange-${payment.id}`">
    {{ t(`financeDocuments.payments.exchange.${outcome.kind}`) }} <Money :amount="outcome.amount" />
  </p>
</template>
