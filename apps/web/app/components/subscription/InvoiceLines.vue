<script setup lang="ts">
import type { Invoice } from '@nasq/commercial-contracts'
import { formatSubscriptionMoney } from '@/utils/subscription'
defineProps<{ invoice: Invoice }>()
const { t, locale } = useI18n()
</script>
<template>
  <div class="space-y-4" data-slot="invoice-lines">
    <p class="text-sm font-medium text-warning" data-testid="not-official">{{ t('subscription.invoices.notOfficial') }}</p>
    <ul class="divide-y divide-default rounded-lg ring ring-default">
      <li v-for="line in invoice.lines" :key="line.key" class="flex items-center justify-between gap-3 p-3">
        <span class="min-w-0">{{ line.description }}
          <span class="ms-2 text-xs text-muted tabular-nums">× {{ line.quantity }}<template v-if="line.free_quantity !== undefined"> · {{ line.free_quantity }} {{ t('subscription.invoices.free') }} · {{ line.quantity - line.free_quantity }} {{ t('subscription.invoices.paidQty') }}</template></span>
        </span>
        <span class="font-medium tabular-nums">{{ formatSubscriptionMoney(line.amount, locale) }}</span>
      </li>
    </ul>
    <dl class="space-y-2 rounded-lg bg-elevated p-3">
      <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('subscription.invoices.subtotal') }}</dt><dd class="tabular-nums">{{ formatSubscriptionMoney(invoice.subtotal, locale) }}</dd></div>
      <div class="flex justify-between gap-3"><dt class="text-muted">{{ t('subscription.invoices.tax') }}</dt><dd class="tabular-nums">{{ formatSubscriptionMoney(invoice.tax, locale) }}</dd></div>
      <div class="flex justify-between gap-3"><dt class="font-semibold">{{ t('subscription.invoices.total') }}</dt><dd class="font-semibold tabular-nums">{{ formatSubscriptionMoney(invoice.total, locale) }}</dd></div>
    </dl>
  </div>
</template>
