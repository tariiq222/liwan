<script setup lang="ts">
import type { Order } from '@nasq/commercial-contracts'
import { orderBadgeColor } from '@/utils/vendorSubscriptions'
const props = defineProps<{ order: Pick<Order, 'payment_state' | 'fulfillment_state'> }>()
const { t } = useI18n()
</script>
<template>
  <span class="inline-flex flex-wrap items-center gap-1.5" data-slot="order-state-badge">
    <UBadge :color="orderBadgeColor(props.order)" variant="subtle">{{ t(`vendor.customers.payment.${props.order.payment_state}`) }}</UBadge>
    <UBadge color="neutral" variant="outline">{{ t(`vendor.customers.fulfillment.${props.order.fulfillment_state}`) }}</UBadge>
  </span>
</template>
