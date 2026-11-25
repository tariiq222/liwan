<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { SalesOrderListItem } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { formatCurrency } from '@/utils/formatCurrency'
import { SALES_STATE_TONE } from './salesStatus'

// The rows of the sales list. The page owns the query, filters and paging; this renders the loaded page.
const props = defineProps<{ rows: SalesOrderListItem[]; loading: boolean; error: unknown; recordTo: (order: SalesOrderListItem) => RouteLocationRaw }>()
const emit = defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()

const NUMBER_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
function column(id: string, header: string, width: string, fit = true, title = false): TableColumn<SalesOrderListItem> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { ...(title ? { title: true } : {}), class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<SalesOrderListItem>['meta'] }
}
const columns = computed<TableColumn<SalesOrderListItem>[]>(() => [
  column('number', t('sales.columns.number'), 'w-[136px] min-w-[136px]', true, true),
  column('customer', t('sales.columns.customer'), 'min-w-[200px]', false),
  column('salesperson', t('sales.columns.salesperson'), 'w-[160px] min-w-[160px]', false),
  column('date', t('sales.columns.date'), 'w-[120px] min-w-[120px]'),
  column('state', t('sales.columns.state'), 'w-[200px] min-w-[200px]'),
  column('source', t('sales.columns.source'), 'w-[112px] min-w-[112px]'),
  column('total', t('sales.columns.total'), 'w-[152px] min-w-[152px]'),
])
const money = (order: SalesOrderListItem) => formatCurrency(order.amount_total, order.currency.name, locale.value)
const salesperson = (order: SalesOrderListItem) => order.salesperson?.name ?? t('sales.noSalesperson')
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,960px)] [&_table]:table-fixed">
    <SharedDataTable bare :rows="props.rows" :columns="columns" row-key="id" :row-to="props.recordTo" :loading="props.loading" :error="props.error" :caption="t('sales.title')" @retry="emit('retry')">
      <template #number-cell="{ row }">
        <NuxtLink :to="props.recordTo(row.original)" :class="NUMBER_LINK" data-testid="sales-order-link"><bdi dir="ltr">{{ row.original.number }}</bdi></NuxtLink>
      </template>
      <template #customer-cell="{ row }">{{ row.original.customer.name }}</template>
      <template #salesperson-cell="{ row }">{{ salesperson(row.original) }}</template>
      <template #date-cell="{ row }"><bdi dir="ltr">{{ formatDate(row.original.date) }}</bdi></template>
      <template #state-cell="{ row }">
        <span class="flex items-center gap-1">
          <SharedStatusBadge :tone="SALES_STATE_TONE[row.original.state]" :label="t(`sales.state.${row.original.state}`)" size="sm" />
          <SharedStatusBadge v-if="row.original.expired" tone="warning" :label="t('sales.expired')" size="sm" data-testid="sales-expired" />
        </span>
      </template>
      <template #source-cell="{ row }">{{ t(`sales.source.${row.original.source}`) }}</template>
      <template #total-cell="{ row }"><bdi dir="ltr">{{ money(row.original) }}</bdi></template>
      <template #mobile-row="{ row }">
        <NuxtLink :to="props.recordTo(row)" class="flex min-w-0 flex-col gap-1">
          <span class="flex min-w-0 items-center justify-between gap-2">
            <span class="min-w-0 truncate font-semibold text-highlighted"><bdi dir="ltr">{{ row.number }}</bdi></span>
            <span class="flex shrink-0 items-center gap-1">
              <SharedStatusBadge :tone="SALES_STATE_TONE[row.state]" :label="t(`sales.state.${row.state}`)" size="sm" />
              <SharedStatusBadge v-if="row.expired" tone="warning" :label="t('sales.expired')" size="sm" />
            </span>
          </span>
          <span class="truncate text-sm text-muted">{{ row.customer.name }} · <bdi dir="ltr">{{ money(row) }}</bdi></span>
          <span class="truncate text-sm text-muted">{{ salesperson(row) }} · {{ t(`sales.source.${row.source}`) }}</span>
        </NuxtLink>
      </template>
    </SharedDataTable>
  </div>
</template>
