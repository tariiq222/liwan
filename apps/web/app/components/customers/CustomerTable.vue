<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RouteLocationRaw } from 'vue-router'
import type { Customer } from '@liwan/contracts'
import { customerName } from '@/composables/customers/customerName'

// The rows of the customers directory. The page owns the query, filters and paging; this renders the loaded page.
const props = defineProps<{ rows: Customer[]; loading: boolean; error: unknown; recordTo: (customer: Customer) => RouteLocationRaw }>()
const emit = defineEmits<{ retry: [] }>()
const { t } = useI18n()

const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
function column(id: string, header: string, width: string, fit = true): TableColumn<Customer> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<Customer>['meta'] }
}
const columns = computed<TableColumn<Customer>[]>(() => [
  column('name', t('customers.columns.name'), 'min-w-[240px]', false),
  column('phone', t('customers.columns.phone'), 'w-[176px] min-w-[176px]'),
  column('email', t('customers.columns.email'), 'min-w-[200px]', false),
  column('scope', t('customers.columns.scope'), 'w-[176px] min-w-[176px]', false),
  column('status', t('customers.columns.status'), 'w-[112px] min-w-[112px]'),
])
const scope = (customer: Customer) => customer.company?.name ?? t('customers.sharedByAllBranches')
</script>

<template>
  <div class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,864px)] [&_table]:table-fixed">
    <SharedDataTable bare :rows="props.rows" :columns="columns" row-key="id" :row-to="props.recordTo" :loading="props.loading" :error="props.error" :caption="t('customers.title')" @retry="emit('retry')">
      <template #name-cell="{ row }">
        <NuxtLink :to="props.recordTo(row.original)" :class="NAME_LINK" data-testid="customer-name-link">{{ customerName(row.original, t) }}</NuxtLink>
        <p v-if="row.original.parent" class="truncate text-xs text-muted">{{ row.original.parent.name }}</p>
      </template>
      <template #phone-cell="{ row }"><bdi v-if="row.original.phone" dir="ltr">{{ row.original.phone }}</bdi><template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template></template>
      <template #email-cell="{ row }"><bdi v-if="row.original.email" dir="ltr">{{ row.original.email }}</bdi><template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template></template>
      <template #scope-cell="{ row }">{{ scope(row.original) }}</template>
      <template #status-cell="{ row }"><SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="t(row.original.active ? 'customers.status.active' : 'customers.status.archived')" /></template>
      <template #mobile-row="{ row }">
        <NuxtLink :to="props.recordTo(row)" class="flex min-w-0 flex-col gap-1">
          <span class="flex min-w-0 items-center gap-2">
            <span class="min-w-0 truncate font-semibold text-highlighted">{{ customerName(row, t) }}</span>
            <SharedStatusBadge size="sm" :tone="row.active ? 'success' : 'neutral'" :label="t(row.active ? 'customers.status.active' : 'customers.status.archived')" />
          </span>
          <span v-if="row.phone" class="truncate text-sm text-muted"><bdi dir="ltr">{{ row.phone }}</bdi></span>
          <span class="truncate text-sm text-muted">{{ scope(row) }}</span>
        </NuxtLink>
      </template>
    </SharedDataTable>
  </div>
</template>
