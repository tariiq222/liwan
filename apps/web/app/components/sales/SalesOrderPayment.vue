<script setup lang="ts">
import type { SalesOrderPayment } from '@liwan/contracts'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import { formatCurrency } from '@/utils/formatCurrency'

// The payment of a quotation on its record page: how it asks to be paid, what it needs and has received, whether the
// customer can pay now (or that no gateway is live to take it), and, when a payment arrived that did not confirm the order, why. The money itself is handled in
// payments; this only reports it. Money that arrived stays visible even when the quotation no longer asks for payment.
const props = defineProps<{ payment: SalesOrderPayment }>()
const { t, locale } = useI18n()
const money = (amount: number) => formatCurrency(amount, props.payment.currency, locale.value)
const TONE: Record<SalesOrderPayment['status'], StatusTone> = { none: 'neutral', payable: 'info', processing: 'info', paid: 'success', not_payable: 'neutral', cancelled: 'destructive' }
const mode = computed(() => (props.payment.mode === 'percent' ? t('sales.payment.mode.percent', { percent: props.payment.percent }) : t(`sales.payment.mode.${props.payment.mode}`)))
const asks = computed(() => props.payment.mode !== 'off')
</script>

<template>
  <UAlert v-if="props.payment.link === 'no_gateway'" role="status" color="warning" variant="subtle" icon="i-lucide-credit-card" :title="t('sales.payment.noGateway.title')" :description="t('sales.payment.noGateway.body')" data-testid="sales-payment-no-gateway">
    <template #actions>
      <UButton color="neutral" variant="outline" size="sm" to="/settings/apps/payments" :label="t('sales.payment.noGateway.action')" data-testid="sales-payment-gateway-settings" />
    </template>
  </UAlert>
  <UAlert v-if="props.payment.held" role="status" color="warning" variant="subtle" icon="i-lucide-hand-coins" :title="t('sales.payment.held.title')" :description="t(`sales.payment.held.${props.payment.held}`, { amount: money(props.payment.amount_received) })" data-testid="sales-payment-held" />
  <UAlert v-if="props.payment.attention" role="alert" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="t('sales.payment.attention.title')" :description="t(`sales.payment.attention.${props.payment.attention}`)" data-testid="sales-payment-attention" />
  <SharedPropertiesPanel :title="t('sales.payment.title')" data-testid="sales-payment">
    <SharedPropertyRow :label="t('sales.payment.asks')" :value="mode" data-testid="sales-payment-mode" />
    <template v-if="asks">
      <SharedPropertyRow :label="t('sales.payment.status')">
        <SharedStatusBadge :tone="TONE[props.payment.status]" :label="t(`sales.payment.statuses.${props.payment.status}`)" size="sm" data-testid="sales-payment-status" />
      </SharedPropertyRow>
      <SharedPropertyRow :label="t('sales.payment.required')"><bdi dir="ltr">{{ money(props.payment.amount_required) }}</bdi></SharedPropertyRow>
    </template>
    <SharedPropertyRow v-if="asks || props.payment.amount_received > 0" :label="t('sales.payment.received')" data-testid="sales-payment-received"><bdi dir="ltr">{{ money(props.payment.amount_received) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-if="asks && props.payment.amount_due > 0" :label="t('sales.payment.due')" data-testid="sales-payment-due"><bdi dir="ltr">{{ money(props.payment.amount_due) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-if="props.payment.amount_to_refund > 0" :label="t('sales.payment.refund')" data-testid="sales-payment-refund"><bdi dir="ltr">{{ money(props.payment.amount_to_refund) }}</bdi></SharedPropertyRow>
    <SharedPropertyRow v-if="asks && props.payment.link !== 'none'" :label="t('sales.payment.link')" :value="t(`sales.payment.links.${props.payment.link}`)" data-testid="sales-payment-link" />
  </SharedPropertiesPanel>
</template>
