<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { OperationProcess } from '@liwan/contracts'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { useOperationProcesses } from '@/composables/operations/useOperations'
import { operationListLocation, safeOperationReturnTo } from '@/composables/operations/forms'
import { operationsStateTone } from '@/composables/operations/state'
import { useRouteListFilters } from '@/composables/useRouteListFilters'

// The process setup list, on the same list template as the request lists. `background` is the list behind the create panel.
const props = defineProps<{ background?: boolean }>()
const PAGE_SIZE = 20
const LIST_PATH = '/settings/apps/operations/processes'
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const { hydrated, page, search, committedSearch, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => LIST_PATH, safeReturnTo: safeOperationReturnTo })
const allowed = computed(() => can('operations.processes.manage'))
const params = computed(() => ({ q: committedSearch.value || undefined, limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE }))
const query = useOperationProcesses(params, allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const backTo = computed(() => operationListLocation(LIST_PATH, route.query, route.hash))
const processTo = (item: OperationProcess) => ({ path: `/settings/apps/operations/processes/${item.id}`, query: { returnTo: backTo.value } })
function clearFilters() {
  search.value = ''
  void update({ q: undefined, page: undefined })
}

const WIDTH = {
  number: 'w-[48px] min-w-[48px] px-2',
  title: 'min-w-[240px]',
  stages: 'w-[144px] min-w-[144px]',
  state: 'w-[144px] min-w-[144px]',
}
function column(id: string, header: TableColumn<OperationProcess>['header'], width: string, fit = false): TableColumn<OperationProcess> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<OperationProcess>['meta'] }
}
const columns = computed<TableColumn<OperationProcess>[]>(() => [
  column('record_number', () => recordNumberHeader(t), WIDTH.number, true),
  column('name', t('operations.name'), WIDTH.title),
  column('stages', t('operations.stages'), WIDTH.stages, true),
  column('state', t('operations.state'), WIDTH.state, true),
])
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('operations.errors.forbidden')" />
  <SharedListCard v-else-if="hydrated">
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="Number(!!committedSearch)" :disabled="!hydrated" @clear="clearFilters">
        <template #search><form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })"><UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('operations.searchProcesses')" :aria-label="t('operations.searchProcesses')" :disabled="!hydrated" /></form></template>
      </SharedFilterBar>
    </template>
    <SharedPageState v-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--liwan-card-pad-dense)" :title="t(committedSearch ? 'app.noResults' : 'operations.emptyProcesses')" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,568px)] [&_table]:table-fixed">
      <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="processTo" :loading="query.isPending.value" :caption="t('operations.nav.processes')">
        <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
        <template #name-cell="{ row }">
          <NuxtLink :to="processTo(row.original)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :title="row.original.name" @click.stop>{{ row.original.name }}</NuxtLink>
        </template>
        <template #stages-cell="{ row }"><span class="text-sm text-muted">{{ t('operations.stageCount', { count: row.original.steps.length }, row.original.steps.length) }}</span></template>
        <template #state-cell="{ row }"><SharedStatusBadge :tone="operationsStateTone(row.original.state)" :label="t(`operations.states.${row.original.state}`)" /></template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="processTo(row)" class="flex min-w-0 flex-col gap-2">
            <span class="flex min-w-0 items-center gap-2"><SharedRecordNumber :value="row.id" /><span class="min-w-0 truncate font-semibold text-highlighted">{{ row.name }}</span></span>
            <span class="flex items-center justify-between gap-2"><span class="text-sm text-muted">{{ t('operations.stageCount', { count: row.steps.length }, row.steps.length) }}</span><SharedStatusBadge :tone="operationsStateTone(row.state)" :label="t(`operations.states.${row.state}`)" /></span>
          </NuxtLink>
        </template>
      </SharedDataTable>
    </div>
    <template v-if="!query.error.value && items.length" #footer>
      <SharedListFooter :count-label="t('operations.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: String(value) })" />
    </template>
  </SharedListCard>
</template>
