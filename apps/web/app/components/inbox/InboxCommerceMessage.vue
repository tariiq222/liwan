<script setup lang="ts">
import type { InboxCommerceProduct, InboxMessage } from '@liwan/contracts'
import InboxOrderActions from '@/components/inbox/InboxOrderActions.vue'
import InboxOrderLines from '@/components/inbox/InboxOrderLines.vue'
import { cartLineRows, formatInboxMoney, orderBadge } from '@/composables/inbox/inboxCommerce'

// The commerce block of a thread message: a product card, a product list (header, count, sections collapsed), the
// catalog card, the chip above a customer's product inquiry, and the customer's cart as a card with its order status and
// (for an agent who may manage orders) the actions. A product that left the catalog still shows its retailer id.
const props = defineProps<{ message: InboxMessage; conversationId?: number; channelId?: number; windowOpen?: boolean }>()
const { t, locale } = useI18n()
const commerce = computed(() => props.message.commerce)
const sent = computed(() => (commerce.value?.type === 'sent' ? commerce.value : null))
const cart = computed(() => (commerce.value?.type === 'order' ? commerce.value : null))
const inquiry = computed(() => (commerce.value?.type === 'inquiry' ? commerce.value : null))
const cartRows = computed(() => (cart.value ? cartLineRows(cart.value) : []))
const cartCurrency = computed(() => cart.value?.lines[0]?.currency ?? 'SAR')
const badge = computed(() => (cart.value?.order ? orderBadge({ state: cart.value.order.state, payment_status: cart.value.order.payment_status }) : null))
const productOf = (id: string) => sent.value?.products.find(item => item.product_retailer_id === id)?.product ?? null
const price = (product: InboxCommerceProduct) => formatInboxMoney(product.price, product.currency, locale.value)
const content = computed(() => sent.value?.content)
const single = computed(() => (content.value?.type === 'product' ? productOf(content.value.product_retailer_id) : null))
const thumbnail = computed(() => (content.value?.type === 'catalog_message' && content.value.thumbnail_product_retailer_id ? productOf(content.value.thumbnail_product_retailer_id) : null))
</script>

<template>
  <div v-if="commerce" class="flex flex-col gap-1.5" :data-testid="`inbox-commerce-${commerce.type}`">
    <p v-if="inquiry" class="inline-flex items-center gap-1.5 self-start rounded-full bg-elevated px-3 py-1 text-xs ring ring-default" data-testid="inbox-inquiry-chip">
      <UIcon name="i-lucide-package" class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
      <span>{{ t('inbox.catalog.thread.inquiry') }}</span>
      <span class="font-medium">{{ inquiry.product?.name ?? inquiry.product_retailer_id }}</span>
    </p>

    <SharedSubCard v-if="content?.type === 'product'" class="flex flex-col gap-1.5" data-testid="inbox-product-card">
      <InboxProductImage v-if="single" :src="single.image_url" :alt="single.name" class="h-40 w-full rounded-control" />
      <p class="font-semibold">{{ single?.name ?? content.product_retailer_id }}</p>
      <p v-if="single" class="text-sm">{{ price(single) }}</p>
      <p v-if="content.body" class="whitespace-pre-wrap">{{ content.body }}</p>
      <p v-if="content.footer" class="text-xs text-muted">{{ content.footer }}</p>
      <p class="inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm text-primary ring ring-default"><UIcon name="i-lucide-shopping-bag" class="size-4" aria-hidden="true" />{{ t('inbox.catalog.thread.view') }}</p>
    </SharedSubCard>

    <SharedSubCard v-else-if="content?.type === 'product_list'" class="flex flex-col gap-1.5" data-testid="inbox-product-list-card">
      <p class="font-semibold">{{ content.header }}</p>
      <p class="whitespace-pre-wrap">{{ content.body }}</p>
      <p v-if="content.footer" class="text-xs text-muted">{{ content.footer }}</p>
      <p class="inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm text-primary ring ring-default"><UIcon name="i-lucide-list" class="size-4" aria-hidden="true" />{{ t('inbox.catalog.thread.products', { n: sent!.products.length }) }}</p>
      <details v-for="(section, index) in content.sections" :key="index" class="text-sm">
        <summary class="cursor-pointer text-xs font-medium text-muted">{{ section.title }} · {{ section.product_retailer_ids.length }}</summary>
        <ul class="mt-1 flex flex-col gap-1">
          <li v-for="id in section.product_retailer_ids" :key="id" class="flex items-center justify-between gap-2">
            <span class="min-w-0 truncate">{{ productOf(id)?.name ?? id }}</span>
            <span v-if="productOf(id)" class="shrink-0 text-xs text-muted">{{ price(productOf(id)!) }}</span>
          </li>
        </ul>
      </details>
    </SharedSubCard>

    <SharedSubCard v-else-if="content?.type === 'catalog_message'" class="flex flex-col gap-1.5" data-testid="inbox-catalog-card">
      <InboxProductImage v-if="thumbnail" :src="thumbnail.image_url" :alt="thumbnail.name" class="h-32 w-full rounded-control" />
      <p class="whitespace-pre-wrap">{{ content.body }}</p>
      <p v-if="content.footer" class="text-xs text-muted">{{ content.footer }}</p>
      <p class="inline-flex items-center gap-1.5 self-start rounded-full px-3 py-1 text-sm text-primary ring ring-default"><UIcon name="i-lucide-store" class="size-4" aria-hidden="true" />{{ t('inbox.catalog.thread.viewCatalog') }}</p>
    </SharedSubCard>

    <SharedSubCard v-else-if="cart" class="flex flex-col gap-2" data-testid="inbox-cart-card">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="flex items-center gap-1.5 font-semibold"><UIcon name="i-lucide-shopping-cart" class="size-4 shrink-0" aria-hidden="true" />{{ t('inbox.orders.cartTitle') }}</p>
        <SharedStatusBadge v-if="badge" size="sm" :tone="badge.tone" :label="cart.order?.reference ? `${cart.order.reference} · ${t(badge.labelKey)}` : t(badge.labelKey)" data-testid="inbox-cart-badge" />
      </div>
      <p v-if="cart.text" class="whitespace-pre-wrap">{{ cart.text }}</p>
      <InboxOrderLines :rows="cartRows" :currency="cartCurrency" />
      <p v-if="cartRows.some(row => row.unknown)" class="text-xs text-error" role="alert" data-testid="inbox-cart-unknown">{{ t('inbox.orders.unknownWarning') }}</p>
      <InboxOrderActions
        v-if="cart.order && props.conversationId && props.channelId"
        :order-id="cart.order.id"
        :state="cart.order.state"
        :payment-status="cart.order.payment_status"
        :conversation-id="props.conversationId"
        :channel-id="props.channelId"
        :window-open="!!props.windowOpen"
      />
    </SharedSubCard>
  </div>
</template>
