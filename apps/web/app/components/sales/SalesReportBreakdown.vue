<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SalesReportBreakdown, SalesReportDimension, SalesReportItem } from '@liwan/contracts'
import { SALES_REPORT_DIMENSIONS, SALES_REPORT_PERIODS } from '@liwan/contracts'
import { PICK_KEY, SALES_REPORT_PAGE_SIZE, type SalesReportState } from '@/composables/sales/salesReportParams'
import { formatCurrency } from '@/utils/formatCurrency'
import { periodLabel } from '@/utils/salesReports'

// The groups of the chosen dimension in one card (the page's filter bar rides in its `filters` slot): the dimension switch (and the period size for a period), the table
// with its amounts, and the pager. A salesperson, customer or product row narrows the whole report to it. The page owns
// the query and the address; this renders the loaded page.
const props = defineProps<{ state: SalesReportState; report: SalesReportBreakdown | undefined; loading: boolean; error: unknown; disabled?: boolean }>()
const emit = defineEmits<{ 'update:query': [values: Record<string, string | undefined>]; retry: [] }>()
const { t, locale, n } = useI18n()

const dimensions = computed(() => SALES_REPORT_DIMENSIONS.map(value => ({ value, label: t(`sales.reports.by.${value}`) })))
const periods = computed(() => SALES_REPORT_PERIODS.map(value => ({ value, label: t(`sales.reports.period.${value}`) })))
const rows = computed(() => props.report?.items ?? [])
const total = computed(() => props.report?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / SALES_REPORT_PAGE_SIZE)))
const isProduct = computed(() => props.state.by === 'product')
const pickKey = computed(() => PICK_KEY[props.state.by])

const money = (amount: number) => formatCurrency(amount, props.report?.currency.name ?? '', locale.value)
function label(item: SalesReportItem): string {
  if (item.key === null || item.label === null) return t(`sales.reports.none.${props.state.by}`)
  return props.state.by === 'period' ? periodLabel(String(item.key), props.state.period, locale.value) : item.label
}
function column(id: string, header: string, width: string, align = 'text-start'): TableColumn<SalesReportItem> {
  return { id, header, meta: { class: { th: `${align} ${width}`, td: `whitespace-nowrap tabular-nums ${width}` } } as TableColumn<SalesReportItem>['meta'] }
}
const columns = computed<TableColumn<SalesReportItem>[]>(() => [
  { id: 'group', header: t(`sales.reports.by.${props.state.by}`), meta: { class: { th: 'text-start min-w-[200px]', td: 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap' } } as TableColumn<SalesReportItem>['meta'] },
  column('orders', t('sales.reports.columns.orders'), 'w-[104px] min-w-[104px]'),
  ...(isProduct.value ? [column('quantity', t('sales.reports.columns.quantity'), 'w-[120px] min-w-[120px]')] : []),
  column('untaxed', t('sales.reports.columns.untaxed'), 'w-[152px] min-w-[152px]'),
  column('total', t('sales.reports.columns.total'), 'w-[152px] min-w-[152px]'),
])
const rowKey = (item: SalesReportItem) => String(item.key ?? 'none')
const canPick = (item: SalesReportItem) => !!pickKey.value && item.key !== null
const pick = (item: SalesReportItem) => { if (pickKey.value && item.key !== null) emit('update:query', { [pickKey.value]: String(item.key), page: undefined }) }
const setBy = (value: string) => emit('update:query', { by: value === 'period' ? undefined : value, page: undefined })
const setPeriod = (value: unknown) => emit('update:query', { period: value === 'month' ? undefined : String(value), page: undefined })
const footer = computed(() => t('sales.reports.footer', { shown: rows.value.length, total: total.value }, total.value))
const isDimension = (value: string): value is SalesReportDimension => (SALES_REPORT_DIMENSIONS as readonly string[]).includes(value)
</script>

<template>
  <SharedListCard data-testid="sales-report-breakdown">
    <template #filters>
      <div class="flex min-w-0 flex-col gap-3">
        <slot name="filters" />
        <div class="flex w-full min-w-0 flex-wrap items-center justify-between gap-3">
          <SharedSegmentedControl data-testid="sales-report-by" :label="t('sales.reports.by.label')" :items="dimensions" :model-value="props.state.by" :disabled="props.disabled" @update:model-value="value => isDimension(value) && setBy(value)" />
          <USelect v-if="props.state.by === 'period'" :model-value="props.state.period" :items="periods" :aria-label="t('sales.reports.period.label')" :disabled="props.disabled" data-testid="sales-report-period" @update:model-value="setPeriod" />
        </div>
      </div>
    </template>
    <SharedPageState v-if="props.error && !props.report" :error="props.error" @retry="emit('retry')" />
    <SharedEmptyState v-else-if="!props.loading && !rows.length" class="m-(--liwan-card-pad-dense)" :title="t('sales.reports.empty')" data-testid="sales-report-empty" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)] [&_table]:table-fixed">
      <SharedDataTable bare :rows="rows" :columns="columns" :row-key="rowKey" :loading="props.loading" :error="null" :caption="t(`sales.reports.by.${props.state.by}`)" @retry="emit('retry')">
        <template #group-cell="{ row }">
          <button v-if="canPick(row.original)" type="button" class="block max-w-full truncate text-start font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :disabled="props.disabled" :title="t('sales.reports.pick')" data-testid="sales-report-pick" @click="pick(row.original)">{{ label(row.original) }}</button>
          <span v-else class="block truncate font-semibold text-highlighted">{{ label(row.original) }}</span>
        </template>
        <template #orders-cell="{ row }">{{ n(row.original.orders) }}</template>
        <template #quantity-cell="{ row }"><bdi dir="ltr">{{ n(row.original.quantity ?? 0) }}</bdi></template>
        <template #untaxed-cell="{ row }"><bdi dir="ltr">{{ money(row.original.amount_untaxed) }}</bdi></template>
        <template #total-cell="{ row }"><bdi dir="ltr">{{ money(row.original.amount_total) }}</bdi></template>
        <template #mobile-row="{ row }">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="truncate font-semibold text-highlighted">{{ label(row) }}</span>
            <span class="truncate text-sm text-muted">{{ t('sales.reports.ordersCount', { count: row.orders }, row.orders) }} · <bdi dir="ltr">{{ money(row.amount_total) }}</bdi></span>
          </div>
        </template>
      </SharedDataTable>
    </div>
    <template v-if="props.report && rows.length" #footer>
      <SharedListFooter :count-label="footer" :page="props.state.page" :pages="pages" :disabled="props.disabled" @update:page="value => emit('update:query', { page: value > 1 ? String(value) : undefined })" />
    </template>
  </SharedListCard>
</template>
