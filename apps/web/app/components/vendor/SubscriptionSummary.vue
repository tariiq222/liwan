<script setup lang="ts">
import type { SubscriptionView } from '@nasq/commercial-contracts'
import { cadenceLabel } from '@/utils/vendorCommercial'
import { displayStateColor, subscriptionDisplayState, targetStatus } from '@/utils/vendorSubscriptions'
const props = defineProps<{ subscription: SubscriptionView; planName?: string }>()
const { t } = useI18n()
const display = computed(() => subscriptionDisplayState(props.subscription))
const status = computed(() => targetStatus(props.subscription))
</script>
<template>
  <div class="space-y-4" data-slot="subscription-summary">
    <div class="flex flex-wrap items-center gap-3">
      <UBadge :color="displayStateColor(display)" variant="subtle">{{ t(`vendor.customers.display.${display}`) }}</UBadge>
      <span v-if="planName" class="font-medium">{{ planName }}</span>
      <span v-if="subscription.applied" class="text-sm text-muted">{{ cadenceLabel(subscription.applied.cadence, t) }}</span>
    </div>
    <dl class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div v-if="subscription.applied"><dt class="text-sm text-muted">{{ t('vendor.customers.sub.period') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ subscription.applied.period_start }} → {{ subscription.applied.period_end }}</bdi></dd></div>
      <div><dt class="text-sm text-muted">{{ t('vendor.customers.renewal') }}</dt><dd class="tabular-nums"><bdi dir="ltr">{{ subscription.renewal_at ?? t('app.notAvailable') }}</bdi></dd></div>
      <div><dt class="text-sm text-muted">{{ t('vendor.customers.sub.autoRenew') }}</dt><dd>{{ subscription.auto_renew.enabled ? t('vendor.common.yes') : t('vendor.common.no') }}</dd></div>
      <div v-if="subscription.trial_ends_at"><dt class="text-sm text-muted">{{ t('vendor.customers.sub.trialEnds') }}</dt><dd><bdi dir="ltr">{{ subscription.trial_ends_at }}</bdi></dd></div>
      <div v-if="subscription.grace_ends_at"><dt class="text-sm text-muted">{{ t('vendor.customers.sub.graceEnds') }}</dt><dd><bdi dir="ltr">{{ subscription.grace_ends_at }}</bdi></dd></div>
    </dl>
    <UAlert v-if="status !== 'applied_only' && status !== 'none'" :color="status === 'target_failed' ? 'error' : 'info'" variant="subtle" :title="t(`vendor.customers.target.${status}`)" :description="t(`vendor.customers.target.${status}Hint`)" />
    <div v-if="subscription.pending_order" class="space-y-1 text-sm">
      <p class="text-muted">{{ t('vendor.customers.sub.pendingOrder') }}</p>
      <VendorOrderStateBadge :order="subscription.pending_order" />
    </div>
  </div>
</template>
