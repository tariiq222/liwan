<script setup lang="ts">
import type { SalesOrder } from '@liwan/contracts'
import { formatCurrency } from '@/utils/formatCurrency'

// The lines of a sales document, read-only, with the amounts the server stored and the document's totals. Sections
// head the lines that follow them; notes are plain text.
const props = defineProps<{ order: SalesOrder }>()
const { t, n, locale } = useI18n()
const money = (amount: number) => formatCurrency(amount, props.order.currency.name, locale.value)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('sales.record.lines')" data-testid="sales-lines-panel">
    <p v-if="!props.order.lines.length" class="text-sm text-muted">{{ t('sales.lines.empty') }}</p>
    <ul v-else class="flex flex-col divide-y divide-default">
      <li v-for="line in props.order.lines" :key="line.id" class="py-2" :data-testid="`sales-record-line-${line.id}`">
        <p v-if="line.kind === 'section'" class="font-semibold text-highlighted">{{ line.name }}</p>
        <p v-else-if="line.kind === 'note'" class="whitespace-pre-line text-sm text-muted">{{ line.name }}</p>
        <div v-else class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted">{{ line.product?.name ?? line.name }}</p>
            <p class="text-xs text-muted">
              <bdi dir="ltr">{{ n(line.quantity) }}</bdi> <bdi>{{ line.unit ?? '' }}</bdi> × <bdi dir="ltr">{{ money(line.unit_price) }}</bdi>
              <template v-if="line.discount_percent"> · <bdi>{{ t('sales.record.discount', { percent: n(line.discount_percent) }) }}</bdi></template>
            </p>
          </div>
          <div class="text-end text-sm">
            <p class="font-semibold text-highlighted"><bdi dir="ltr">{{ money(line.amount_total) }}</bdi></p>
            <p class="text-xs text-muted">{{ t('sales.record.untaxed') }} <bdi dir="ltr">{{ money(line.amount_untaxed) }}</bdi></p>
          </div>
        </div>
      </li>
    </ul>
    <dl class="mt-3 flex flex-col gap-1 border-t border-default pt-3 text-sm">
      <div class="flex justify-between gap-4"><dt class="text-muted">{{ t('sales.record.untaxed') }}</dt><dd><bdi dir="ltr">{{ money(props.order.amount_untaxed) }}</bdi></dd></div>
      <div class="flex justify-between gap-4"><dt class="text-muted">{{ t('sales.record.tax') }}</dt><dd><bdi dir="ltr">{{ money(props.order.amount_tax) }}</bdi></dd></div>
      <div class="flex justify-between gap-4 font-semibold text-highlighted"><dt>{{ t('sales.columns.total') }}</dt><dd data-testid="sales-total"><bdi dir="ltr">{{ money(props.order.amount_total) }}</bdi></dd></div>
    </dl>
  </SharedRecordSection>
</template>
