<script setup lang="ts">
import type { SalesPublicPayment } from '@liwan/contracts'
import { formatCurrency } from '@/utils/formatCurrency'

// What the holder of a quotation link can do about its payment, when the sender asked for payment before the order is
// confirmed: pay now (a link to the pay page, which has its own authorization), sign first, wait for a payment that is
// on its way (with a way to read it again), or nothing. The pay page itself takes the payment; this only says how much and
// where. A payment that arrived but did not confirm the order yet is `received`; when the customer still has to sign, the
// signature is the step that remains. The container is always there and polite, so a change of state is announced; a null payment leaves it empty.
const props = defineProps<{ payment: SalesPublicPayment | null; refreshing?: boolean; signFirst?: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const { t, locale } = useI18n()
const amount = computed(() => (props.payment ? formatCurrency(props.payment.amount, props.payment.currency, locale.value) : ''))
const whole = computed(() => props.payment?.percent === 100)

const NOTICE: Partial<Record<SalesPublicPayment['state'], { color: 'info' | 'success' | 'warning'; icon: string }>> = {
  awaiting_signature: { color: 'info', icon: 'i-lucide-pen-line' },
  processing: { color: 'info', icon: 'i-lucide-loader' },
  paid: { color: 'success', icon: 'i-lucide-circle-check' },
  received: { color: 'success', icon: 'i-lucide-circle-check' },
  unavailable: { color: 'warning', icon: 'i-lucide-credit-card' },
}
// A state with no notice here (the contract's list may grow) renders nothing.
const notice = computed(() => (props.payment && props.payment.state !== 'payable' ? NOTICE[props.payment.state] ?? null : null))
</script>

<template>
  <div role="status" aria-live="polite" class="empty:hidden" data-testid="quote-live-region">
    <SharedRecordSection v-if="props.payment && props.payment.state === 'payable' && props.payment.pay_url" variant="action" :title="t('sales.quote.payment.title')" data-testid="quote-payment">
      <p class="mb-4 text-sm text-default" data-testid="quote-payment-hint">{{ t(whole ? 'sales.quote.payment.hintFull' : 'sales.quote.payment.hintPercent', { amount, percent: props.payment.percent }) }}</p>
      <UButton size="lg" icon="i-lucide-credit-card" :to="props.payment.pay_url" :label="t('sales.quote.payment.pay', { amount })" data-testid="quote-pay" />
    </SharedRecordSection>
    <UAlert v-else-if="props.payment && notice" :color="notice.color" variant="subtle" :icon="notice.icon" :title="t(`sales.quote.payment.states.${props.payment.state}.title`)" :description="t(`sales.quote.payment.states.${props.payment.state}.${props.payment.state === 'received' && props.signFirst ? 'signBody' : 'body'}`, { amount })" :data-testid="`quote-payment-${props.payment.state}`">
      <template v-if="props.payment.state === 'processing' || props.payment.state === 'received'" #actions>
        <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-refresh-cw" :loading="props.refreshing" :label="t('sales.quote.payment.refresh')" data-testid="quote-payment-refresh" @click="emit('refresh')" />
      </template>
    </UAlert>
  </div>
</template>
