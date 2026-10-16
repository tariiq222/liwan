<script setup lang="ts">
import { customerDisplayBadge } from '@/utils/vendorBadges'
import { orderFulfillmentBadge, orderPaymentBadge } from '@/utils/vendorSubscriptions'
import type { SubscriptionView } from '@nasq/commercial-contracts'
import { cadenceLabel, formatCommercialMoney } from '@nasq/commercial-ui/app/utils/commercial'
import { formatNasqDate } from '@nasq/ui/app/composables/calendarDate'
import { subscriptionDisplayState, targetStatus } from '@/utils/vendorSubscriptions'
const props = defineProps<{ subscription: SubscriptionView; planName?: string }>()
const { t, locale } = useI18n()
const display = computed(() => subscriptionDisplayState(props.subscription))
const status = computed(() => targetStatus(props.subscription))
const date = (value: string | null | undefined) => (value ? formatNasqDate(value, locale.value) : null)
const order = computed(() => props.subscription.pending_order)
</script>
<template>
  <div class="space-y-4" data-slot="subscription-summary">
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge :tone="customerDisplayBadge(display).tone" :label="t(customerDisplayBadge(display).labelKey)" /></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.customers.plan')" :value="planName" />
      <SharedPropertyRow :label="t('commercial.pricing.quote.cadence')" :value="subscription.applied ? cadenceLabel(subscription.applied.cadence, t) : null" />
      <SharedPropertyRow :label="t('vendor.customers.sub.period')" :value="subscription.applied ? t('vendor.customers.sub.periodRange', { from: date(subscription.applied.period_start), to: date(subscription.applied.period_end) }) : null" />
      <SharedPropertyRow :label="t('vendor.customers.renewal')" :value="date(subscription.renewal_at)" />
      <SharedPropertyRow :label="t('vendor.customers.sub.autoRenew')" :value="subscription.auto_renew.enabled ? t('vendor.common.yes') : t('vendor.common.no')" />
      <SharedPropertyRow v-if="subscription.trial_ends_at" :label="t('vendor.customers.sub.trialEnds')" :value="date(subscription.trial_ends_at)" />
      <SharedPropertyRow v-if="subscription.grace_ends_at" :label="t('vendor.customers.sub.graceEnds')" :value="date(subscription.grace_ends_at)" />
      <slot />
    </SharedPropertiesPanel>
    <UAlert v-if="status !== 'applied_only' && status !== 'none'" :color="status === 'target_failed' ? 'error' : 'info'" variant="subtle" :ui="{ title: 'text-default', description: 'text-default' }" :title="t(`vendor.customers.target.${status}`)" :description="t(`vendor.customers.target.${status}Hint`)" />
    <section v-if="order" class="space-y-3 rounded-lg p-4 ring ring-default" aria-labelledby="pending-order-title" data-slot="pending-order">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 id="pending-order-title" class="text-sm font-semibold text-highlighted">{{ t('vendor.customers.sub.pendingOrder') }} · {{ t(`vendor.customers.order.kind.${order.kind}`) }}</h3>
        <span class="inline-flex flex-wrap items-center gap-1.5" data-slot="order-state-badge">
          <SharedStatusBadge :tone="orderPaymentBadge(order).tone" :label="t(orderPaymentBadge(order).labelKey)" />
          <SharedStatusBadge variant="outline" :tone="orderFulfillmentBadge(order).tone" :label="t(orderFulfillmentBadge(order).labelKey)" />
        </span>
      </div>
      <dl class="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt class="text-muted">{{ t('vendor.customers.order.due') }}</dt><dd class="font-semibold tabular-nums"><bdi dir="ltr">{{ formatCommercialMoney(order.due_now, locale) }}</bdi></dd></div>
        <div><dt class="text-muted">{{ t('vendor.customers.order.created') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ date(order.created_at) }}</bdi></dd></div>
      </dl>
      <slot name="order-actions" />
    </section>
  </div>
</template>
