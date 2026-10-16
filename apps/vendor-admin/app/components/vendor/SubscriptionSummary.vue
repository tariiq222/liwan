<script setup lang="ts">
import { customerDisplayBadge } from '@/utils/vendorBadges'
import { orderFulfillmentBadge, orderPaymentBadge } from '@/utils/vendorSubscriptions'
import type { SubscriptionView } from '@nasq/commercial-contracts'
import { cadenceLabel } from '@nasq/commercial-ui/app/utils/commercial'
import { subscriptionDisplayState, targetStatus } from '@/utils/vendorSubscriptions'
const props = defineProps<{ subscription: SubscriptionView; planName?: string }>()
const { t } = useI18n()
const display = computed(() => subscriptionDisplayState(props.subscription))
const status = computed(() => targetStatus(props.subscription))
</script>
<template>
  <div class="space-y-4" data-slot="subscription-summary">
    <SharedPropertiesPanel>
      <SharedPropertyRow :label="t('vendor.common.status')"><SharedStatusBadge :tone="customerDisplayBadge(display).tone" :label="t(customerDisplayBadge(display).labelKey)" /></SharedPropertyRow>
      <SharedPropertyRow :label="t('vendor.customers.plan')" :value="planName" />
      <SharedPropertyRow :label="t('commercial.pricing.quote.cadence')" :value="subscription.applied ? cadenceLabel(subscription.applied.cadence, t) : null" />
      <SharedPropertyRow v-if="subscription.applied" :label="t('vendor.customers.sub.period')"><bdi dir="ltr">{{ subscription.applied.period_start }} → {{ subscription.applied.period_end }}</bdi></SharedPropertyRow><SharedPropertyRow v-else :label="t('vendor.customers.sub.period')" :value="null" />
      <SharedPropertyRow v-if="subscription.renewal_at" :label="t('vendor.customers.renewal')"><bdi dir="ltr">{{ subscription.renewal_at }}</bdi></SharedPropertyRow><SharedPropertyRow v-else :label="t('vendor.customers.renewal')" :value="null" />
      <SharedPropertyRow :label="t('vendor.customers.sub.autoRenew')" :value="subscription.auto_renew.enabled ? t('vendor.common.yes') : t('vendor.common.no')" />
      <SharedPropertyRow v-if="subscription.trial_ends_at" :label="t('vendor.customers.sub.trialEnds')"><bdi dir="ltr">{{ subscription.trial_ends_at }}</bdi></SharedPropertyRow><SharedPropertyRow v-else :label="t('vendor.customers.sub.trialEnds')" :value="null" />
      <SharedPropertyRow v-if="subscription.grace_ends_at" :label="t('vendor.customers.sub.graceEnds')"><bdi dir="ltr">{{ subscription.grace_ends_at }}</bdi></SharedPropertyRow><SharedPropertyRow v-else :label="t('vendor.customers.sub.graceEnds')" :value="null" />
      <slot />
    </SharedPropertiesPanel>
    <UAlert v-if="status !== 'applied_only' && status !== 'none'" :color="status === 'target_failed' ? 'error' : 'info'" variant="subtle" :ui="{ title: 'text-default', description: 'text-default' }" :title="t(`vendor.customers.target.${status}`)" :description="t(`vendor.customers.target.${status}Hint`)" />
    <div v-if="subscription.pending_order" class="space-y-1 text-sm">
      <p class="text-muted">{{ t('vendor.customers.sub.pendingOrder') }}</p>
      <span class="inline-flex flex-wrap items-center gap-1.5" data-slot="order-state-badge">
        <SharedStatusBadge :tone="orderPaymentBadge(subscription.pending_order).tone" :label="t(orderPaymentBadge(subscription.pending_order).labelKey)" />
        <SharedStatusBadge variant="outline" :tone="orderFulfillmentBadge(subscription.pending_order).tone" :label="t(orderFulfillmentBadge(subscription.pending_order).labelKey)" />
      </span>
    </div>
  </div>
</template>
