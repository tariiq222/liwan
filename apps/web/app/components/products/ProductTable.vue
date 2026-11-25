<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { Product } from '@liwan/contracts'
import { formatCurrency } from '@/utils/formatCurrency'

// The rows of the products list. The page owns the query, filters and paging; this renders the loaded page. Two prices
// are shown on purpose: the one typed on the product and the total one unit costs the customer, tax included.
const props = defineProps<{ rows: Product[]; loading: boolean; error: unknown; recordTo: (product: Product) => RouteLocationRaw }>()
const emit = defineEmits<{ retry: [] }>()
const { t, locale } = useI18n()

const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
function column(id: string, header: string, width: string, fit = true, title = false): TableColumn<Product> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { ...(title ? { title: true } : {}), class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<Product>['meta'] }
}
const columns = computed<TableColumn<Product>[]>(() => [
  column('name', t('products.columns.name'), 'min-w-[240px]', false, true),
  column('type', t('products.columns.type'), 'w-[112px] min-w-[112px]'),
  column('listPrice', t('products.columns.listPrice'), 'w-[160px] min-w-[160px]'),
  column('total', t('products.columns.total'), 'w-[160px] min-w-[160px]'),
  column('scope', t('products.columns.scope'), 'w-[176px] min-w-[176px]', false),
  column('status', t('products.status.label'), 'w-[112px] min-w-[112px]'),
])
const money = (amount: number, product: Product) => formatCurrency(amount, product.price.currency.name, locale.value)
const scope = (product: Product) => product.company?.name ?? t('products.sharedByAllBranches')
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,960px)] [&_table]:table-fixed">
    <SharedDataTable bare :rows="props.rows" :columns="columns" row-key="id" :row-to="props.recordTo" :loading="props.loading" :error="props.error" :caption="t('products.title')" @retry="emit('retry')">
      <template #name-cell="{ row }">
        <NuxtLink :to="props.recordTo(row.original)" :class="NAME_LINK" data-testid="product-name-link">{{ row.original.name }}</NuxtLink>
        <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <SharedRecordNumber :value="row.original.id" />
        </div>
      </template>
      <template #type-cell="{ row }">{{ t(`products.type.${row.original.type}`) }}</template>
      <template #listPrice-cell="{ row }"><bdi dir="ltr">{{ money(row.original.list_price, row.original) }}</bdi></template>
      <template #total-cell="{ row }"><bdi dir="ltr">{{ money(row.original.price.amount_total, row.original) }}</bdi></template>
      <template #scope-cell="{ row }">{{ scope(row.original) }}</template>
      <template #status-cell="{ row }"><SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="t(row.original.active ? 'products.status.active' : 'products.status.archived')" /></template>
      <template #mobile-row="{ row }">
        <NuxtLink :to="props.recordTo(row)" class="flex min-w-0 flex-col gap-1">
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate font-semibold text-highlighted">{{ row.name }}</span>
            <SharedStatusBadge size="sm" :tone="row.active ? 'success' : 'neutral'" :label="t(row.active ? 'products.status.active' : 'products.status.archived')" />
          </span>
          <span class="truncate text-sm text-muted">{{ t(`products.type.${row.type}`) }} · <bdi dir="ltr">{{ money(row.price.amount_total, row) }}</bdi></span>
          <span class="truncate text-sm text-muted">{{ scope(row) }}</span>
        </NuxtLink>
      </template>
    </SharedDataTable>
  </div>
</template>
