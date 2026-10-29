<script setup lang="ts">
import { formatInboxMoney, rowPrice, rowPriceChanged, rowsTotal, type OrderLineRow } from '@/composables/inbox/inboxCommerce'

// The lines of a cart or an order with today's prices, the total, and a warning beside a line whose product is not in the
// catalog (the order cannot be placed until it is removed), is out of stock, or costs something else than the cart said.
const props = defineProps<{ rows: OrderLineRow[]; currency: string }>()
const { t, locale } = useI18n()
const total = computed(() => rowsTotal(props.rows))
const money = (amount: number | null) => (amount === null ? '—' : formatInboxMoney(amount, props.currency, locale.value))
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="inbox-order-lines">
    <ul class="flex flex-col divide-y divide-default" :aria-label="t('inbox.orders.lines')">
      <li v-for="row in props.rows" :key="row.key" class="flex items-start justify-between gap-3 py-1.5" :data-testid="`inbox-order-line-${row.key}`">
        <span class="min-w-0">
          <span class="block truncate text-sm font-medium text-highlighted">{{ row.quantity }} × {{ row.name }}</span>
          <span class="flex flex-wrap items-center gap-1 text-xs text-muted">
            <bdi dir="ltr">{{ row.retailerId }}</bdi>
            <SharedStatusBadge v-if="row.unknown" size="sm" tone="destructive" :label="t('inbox.orders.unknownProduct')" />
            <SharedStatusBadge v-else-if="row.outOfStock" size="sm" tone="warning" :label="t('inbox.catalog.availability.out_of_stock')" />
            <SharedStatusBadge v-if="rowPriceChanged(row)" size="sm" tone="warning" :label="t('inbox.orders.wasPrice', { price: money(row.cartPrice) })" />
          </span>
        </span>
        <span class="shrink-0 text-sm tabular-nums">{{ money(rowPrice(row) === null ? null : rowPrice(row)! * row.quantity) }}</span>
      </li>
    </ul>
    <p class="flex items-center justify-between gap-3 text-sm font-semibold text-highlighted" data-testid="inbox-order-total">
      <span>{{ t('inbox.orders.total') }}</span>
      <span class="tabular-nums">{{ money(total.total) }}<template v-if="!total.complete"> +</template></span>
    </p>
  </div>
</template>
