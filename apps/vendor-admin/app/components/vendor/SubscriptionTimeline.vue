<script setup lang="ts">
import type { SubscriptionView } from '@liwan/commercial-contracts'
import { cadenceLabel } from '@liwan/commercial-ui/app/utils/commercial'
import type { StatusTone } from '@liwan/ui/app/utils/statusTone'
import { formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { orderFulfillmentBadge, orderPaymentBadge } from '@/utils/vendorSubscriptions'

// What changed on the subscription, newest first, from the revisions the control plane returns.
const props = defineProps<{ subscription: SubscriptionView; planName: (revisionId: string) => string | undefined }>()
const { t } = useI18n()
const when = (value: string) => formatLiwanDateTime(value)
const events = computed(() => {
  const { applied, target, pending_order: order } = props.subscription
  const list: { key: string; at: string; icon: string; title: string; detail: string; badges?: { tone: StatusTone; label: string }[] }[] = []
  if (order) {
    list.push({ key: `order-${order.id}`, at: order.created_at, icon: 'i-lucide-shopping-cart', title: t('vendor.customers.history.order', { kind: t(`vendor.customers.order.kind.${order.kind}`) }), detail: '', badges: [{ ...orderPaymentBadge(order), label: t(orderPaymentBadge(order).labelKey) }, { ...orderFulfillmentBadge(order), label: t(orderFulfillmentBadge(order).labelKey) }] })
  }
  if (target && target.id !== applied?.id) {
    list.push({ key: `target-${target.id}`, at: target.created_at, icon: 'i-lucide-clock', title: t('vendor.customers.history.target', { revision: target.revision }), detail: revisionDetail(target) })
  }
  if (applied) {
    list.push({ key: `applied-${applied.id}`, at: applied.created_at, icon: 'i-lucide-circle-check', title: t('vendor.customers.history.applied', { revision: applied.revision }), detail: revisionDetail(applied) })
  }
  return list.sort((a, b) => b.at.localeCompare(a.at))
})
function revisionDetail(revision: NonNullable<SubscriptionView['applied']>): string {
  const plan = props.planName(revision.plan_revision_id)
  return [plan, cadenceLabel(revision.cadence, t), revision.terms_revision_id ? t('vendor.customers.history.termsCustom') : t('vendor.customers.history.termsPlan')].filter(Boolean).join(' · ')
}
</script>

<template>
  <div data-slot="subscription-timeline">
    <p v-if="!events.length" class="text-sm text-muted">{{ t('vendor.customers.history.empty') }}</p>
    <ol v-else class="relative space-y-5 border-s border-default ps-5" data-testid="subscription-timeline">
      <li v-for="event in events" :key="event.key" class="relative">
        <span class="absolute -start-[1.9rem] top-0.5 flex size-5 items-center justify-center rounded-full bg-default ring ring-default"><UIcon :name="event.icon" class="size-3.5 text-muted" aria-hidden="true" /></span>
        <p class="text-sm font-medium text-highlighted">{{ event.title }}</p>
        <p v-if="event.detail" class="text-sm text-muted">{{ event.detail }}</p>
        <div v-if="event.badges" class="mt-1 flex flex-wrap gap-1.5"><SharedStatusBadge v-for="badge in event.badges" :key="badge.label" :tone="badge.tone" :label="badge.label" /></div>
        <time class="mt-0.5 block text-xs text-muted tabular-nums" :datetime="event.at"><bdi dir="ltr">{{ when(event.at) }}</bdi></time>
      </li>
    </ol>
  </div>
</template>
