<script setup lang="ts">
import type { InboxOrder } from '@liwan/contracts'
import InboxOrderActions from '@/components/inbox/InboxOrderActions.vue'
import InboxOrderLines from '@/components/inbox/InboxOrderLines.vue'
import { expiryCountdown, formatInboxMoney, orderBadge, orderLineRows } from '@/composables/inbox/inboxCommerce'

// One order: its reference and status badge, the lines at today's prices, a warning when the prices moved since the
// cart, the payment (expiry countdown, refund or attention flags) and, for an agent who may manage orders, the actions.
// `showContext` adds the customer and channel for the orders list; otherwise the card sits inside its conversation.
const props = withDefaults(defineProps<{ order: InboxOrder; windowOpen?: boolean; showContext?: boolean; now?: number }>(), { windowOpen: false, showContext: false, now: undefined })
const { t, locale } = useI18n()
const badge = computed(() => orderBadge({ state: props.order.state, payment_status: props.order.payment?.status ?? null }))
const rows = computed(() => orderLineRows(props.order))
const countdown = computed(() => (props.order.payment?.status === 'payable' ? expiryCountdown(props.order.payment.expires_at, props.now) : null))
const sentAt = computed(() => (props.order.pay_link_sent_at ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.order.pay_link_sent_at)) : null))
</script>

<template>
  <SharedSubCard class="flex flex-col gap-2" :data-testid="`inbox-order-card-${props.order.id}`">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="min-w-0 truncate text-sm font-semibold text-highlighted">
        <bdi v-if="props.order.reference" dir="ltr">{{ props.order.reference }}</bdi><template v-else>{{ t('inbox.orders.cartTitle') }}</template>
      </p>
      <SharedStatusBadge size="sm" :tone="badge.tone" :label="t(badge.labelKey)" data-testid="inbox-order-badge" />
    </div>
    <p v-if="props.showContext" class="text-xs text-muted">
      <NuxtLink :to="`/inbox/${props.order.conversation_id}`" class="text-brand-link underline" data-testid="inbox-order-conversation">{{ props.order.contact.name }}</NuxtLink> · {{ props.order.channel.name }}
    </p>
    <InboxOrderLines :rows="rows" :currency="props.order.currency" />
    <UAlert v-if="props.order.price_changed && props.order.state === 'cart'" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="t('inbox.orders.priceChanged', { cart: formatInboxMoney(props.order.cart_total ?? 0, props.order.cart_currency ?? props.order.currency, locale), now: formatInboxMoney(props.order.total, props.order.currency, locale) })" data-testid="inbox-order-price-changed" />
    <UAlert v-if="props.order.payment?.refund_due" color="error" variant="subtle" icon="i-lucide-undo-2" :description="t('inbox.orders.refundDue')" data-testid="inbox-order-refund" />
    <UAlert v-if="props.order.payment?.needs_attention" color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="t('inbox.orders.needsAttention')" data-testid="inbox-order-attention" />
    <p v-if="countdown" class="text-xs" :class="countdown.expired ? 'text-error' : 'text-muted'" data-testid="inbox-order-expiry">{{ countdown.expired ? t('inbox.orders.expired') : t('inbox.orders.expiresIn', { minutes: countdown.minutes }) }}</p>
    <p v-if="sentAt" class="text-xs text-muted">{{ t('inbox.orders.linkSentAt', { time: sentAt }) }}</p>
    <InboxOrderActions :order-id="props.order.id" :state="props.order.state" :payment-status="props.order.payment?.status ?? null" :conversation-id="props.order.conversation_id" :channel-id="props.order.channel.id" :window-open="props.windowOpen" />
  </SharedSubCard>
</template>
