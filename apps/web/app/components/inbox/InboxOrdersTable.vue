<script setup lang="ts">
import type { InboxOrder } from '@liwan/contracts'
import { formatInboxMoney, orderBadge } from '@/composables/inbox/inboxCommerce'

// The orders list across the conversations the viewer can see: one row per order with its customer, channel, total and
// status badge; a row opens its conversation.
const props = defineProps<{ orders: InboxOrder[] }>()
const { t, locale } = useI18n()
const day = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
</script>

<template>
  <ul class="flex flex-col divide-y divide-default" :aria-label="t('inbox.orders.title')" data-testid="inbox-orders-table">
    <li v-for="order in props.orders" :key="order.id">
      <NuxtLink :to="`/inbox/${order.conversation_id}/orders`" class="flex flex-wrap items-center justify-between gap-3 px-(--liwan-card-pad) py-3 text-start transition-colors hover:bg-(--liwan-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary" :data-testid="`inbox-orders-row-${order.id}`">
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted"><bdi v-if="order.reference" dir="ltr">{{ order.reference }}</bdi><template v-else>{{ t('inbox.orders.cartTitle') }}</template> · {{ order.contact.name }}</span>
          <span class="block truncate text-xs text-muted">{{ order.channel.name }} · {{ t('inbox.orders.lineCount', { n: order.lines.length }) }} · <time :datetime="order.created_at">{{ day.format(new Date(order.created_at)) }}</time></span>
        </span>
        <span class="flex items-center gap-3">
          <span class="text-sm font-semibold tabular-nums">{{ formatInboxMoney(order.total, order.currency, locale) }}</span>
          <SharedStatusBadge size="sm" :tone="orderBadge({ state: order.state, payment_status: order.payment?.status ?? null }).tone" :label="t(orderBadge({ state: order.state, payment_status: order.payment?.status ?? null }).labelKey)" />
          <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
        </span>
      </NuxtLink>
    </li>
  </ul>
</template>
