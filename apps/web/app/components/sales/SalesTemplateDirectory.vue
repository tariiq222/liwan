<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { SalesTemplateItem } from '@liwan/contracts'
import { SALES_TEMPLATE_LIST_KEYS, SALES_TEMPLATE_PAGE_SIZE, SALES_TEMPLATES_PATH, parseSalesTemplateQuery } from '@/composables/sales/salesTemplateParams'
import { useSalesTemplates } from '@/composables/sales/useSalesTemplates'
import { listLocation, safeListReturnTo, useLastPageClamp, useRouteListFilters } from '@/composables/useRouteListFilters'

// The body of the templates page: search by name, the archived switch and the templates in one card. The filters live in
// the URL query, so a record and the browser's Back return to the same list. `background` is the list behind the create
// panel: it reads its filters from the panel's returnTo. The page owns the SharedListPage shell.
const props = defineProps<{ background?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, search, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => SALES_TEMPLATES_PATH, safeReturnTo: value => safeListReturnTo(SALES_TEMPLATES_PATH, value) })

const state = computed(() => parseSalesTemplateQuery(filterQuery.value))
const query = useSalesTemplates(state, () => can('sales.settings.manage'))
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / SALES_TEMPLATE_PAGE_SIZE)))
useLastPageClamp({ page: () => state.value.page, total: () => query.data.value?.total, pageSize: SALES_TEMPLATE_PAGE_SIZE })
const activeCount = computed(() => Number(Boolean(state.value.q)) + Number(state.value.archived))
const backTo = computed(() => listLocation(SALES_TEMPLATES_PATH, SALES_TEMPLATE_LIST_KEYS, filterQuery.value, route.hash))
const recordTo = (template: SalesTemplateItem) => ({ path: `${SALES_TEMPLATES_PATH}/${template.id}`, query: { returnTo: backTo.value } })
function setArchived(value: boolean | 'indeterminate') { void update({ archived: value === true ? '1' : undefined, page: undefined }) }
function clearFilters() { search.value = ''; void update({ q: undefined, archived: undefined, page: undefined }) }
const emptyText = computed(() => t(activeCount.value ? 'app.noResults' : 'sales.templates.empty'))

const NAME_LINK = 'block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
function column(id: string, header: string, width: string, fit = true): TableColumn<SalesTemplateItem> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<SalesTemplateItem>['meta'] }
}
const columns = computed<TableColumn<SalesTemplateItem>[]>(() => [
  column('name', t('sales.templates.columns.name'), 'min-w-[220px]', false),
  column('lines', t('sales.templates.columns.lines'), 'w-[120px] min-w-[120px]'),
  column('validity', t('sales.templates.columns.validity'), 'w-[160px] min-w-[160px]'),
  column('state', t('sales.templates.columns.state'), 'w-[200px] min-w-[200px]'),
])
const validity = (template: SalesTemplateItem) => template.validity_days ? t('sales.templates.days', { count: template.validity_days }, template.validity_days) : t('sales.templates.settingsValidity')
</script>

<template>
  <SharedForbiddenState v-if="!can('sales.settings.manage')" />
  <div v-else class="flex min-w-0 flex-col gap-4">
    <SharedListCard>
      <template #filters>
        <SharedFilterBar embedded class="w-full" :active-count="activeCount" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
              <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('sales.templates.search')" :aria-label="t('sales.templates.search')" :disabled="!hydrated" data-testid="sales-template-search" />
            </form>
          </template>
          <UCheckbox :model-value="state.archived" :label="t('sales.templates.archivedOnly')" :disabled="!hydrated" data-testid="sales-template-archived" @update:model-value="setArchived" />
        </SharedFilterBar>
      </template>
      <SharedPageState v-if="query.error.value && !query.data.value" :error="query.error.value" @retry="query.refetch()" />
      <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="emptyText">
        <template v-if="activeCount" #action><UButton color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('sales.clear')" @click="clearFilters" /></template>
      </SharedEmptyState>
      <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,640px)] [&_table]:table-fixed">
        <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :error="null" :caption="t('sales.templates.title')" @retry="query.refetch()">
          <template #name-cell="{ row }">
            <NuxtLink :to="recordTo(row.original)" :class="NAME_LINK" data-testid="sales-template-link">{{ row.original.name }}</NuxtLink>
          </template>
          <template #lines-cell="{ row }">{{ t('sales.templates.lineCount', { count: row.original.line_count }, row.original.line_count) }}</template>
          <template #validity-cell="{ row }">{{ validity(row.original) }}</template>
          <template #state-cell="{ row }">
            <span class="flex items-center gap-1">
              <SharedStatusBadge v-if="row.original.archived" tone="neutral" :label="t('sales.templates.archived')" size="sm" />
              <SharedStatusBadge v-else-if="!row.original.usable" tone="warning" :label="t('sales.templates.needsAttention')" size="sm" data-testid="sales-template-unusable" />
              <SharedStatusBadge v-else tone="success" :label="t('sales.templates.ready')" size="sm" />
            </span>
          </template>
          <template #mobile-row="{ row }">
            <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-1">
              <span class="truncate font-semibold text-highlighted">{{ row.name }}</span>
              <span class="truncate text-sm text-muted">{{ t('sales.templates.lineCount', { count: row.line_count }, row.line_count) }} · {{ validity(row) }}</span>
            </NuxtLink>
          </template>
        </SharedDataTable>
      </div>
      <template v-if="query.data.value && items.length" #footer>
        <SharedListFooter :count-label="t('sales.templates.footer', { shown: items.length, total }, total)" :page="state.page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: value > 1 ? String(value) : undefined })" />
      </template>
    </SharedListCard>
  </div>
</template>
