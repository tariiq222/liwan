<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { OperationProcess } from '@liwan/contracts'
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

// Reading order: the title (strongest text) with its muted record number below, then stage count and state.
const columns = computed<TableColumn<OperationProcess>[]>(() => [
  { accessorKey: 'name', header: t('operations.name'), meta: { title: true, class: { th: 'min-w-64', td: 'max-w-0' } } },
  { id: 'stages', header: t('operations.stages'), meta: { class: { th: 'w-36 text-start', td: 'w-36 whitespace-nowrap' } } },
  { accessorKey: 'state', header: t('operations.state'), meta: { class: { th: 'w-36 text-start', td: 'w-36 whitespace-nowrap' } } },
])
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('operations.errors.forbidden')" />
  <SharedListCard v-else>
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="Number(!!committedSearch)" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })">
            <UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('operations.searchProcesses')" :aria-label="t('operations.searchProcesses')" :disabled="!hydrated" />
          </form>
        </template>
      </SharedFilterBar>
    </template>
    <SharedPageState v-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <SharedEmptyState v-else-if="!query.isPending.value && !items.length" :icon="committedSearch ? 'i-lucide-filter-x' : 'i-lucide-workflow'" class="m-(--liwan-card-pad-dense)" :title="t(committedSearch ? 'app.noResults' : 'operations.emptyProcesses')">
      <template v-if="committedSearch" #action>
        <UButton type="button" color="neutral" variant="outline" size="sm" :disabled="!hydrated" :label="t('filterCard.clear')" @click="clearFilters" />
      </template>
    </SharedEmptyState>
    <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :row-to="processTo" :loading="query.isPending.value" :caption="t('operations.nav.processes')">
      <template #name-cell="{ row }">
        <NuxtLink :to="processTo(row.original)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :title="row.original.name" @click.stop>{{ row.original.name }}</NuxtLink>
        <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <SharedRecordNumber :value="row.original.id" />
        </div>
      </template>
      <template #stages-cell="{ row }"><span class="text-sm text-muted">{{ t('operations.stageCount', { count: row.original.steps.length }, row.original.steps.length) }}</span></template>
      <template #state-cell="{ row }"><SharedStatusBadge :tone="operationsStateTone(row.original.state)" :label="t(`operations.states.${row.original.state}`)" /></template>
      <template #mobile-row="{ row }">
        <NuxtLink :to="processTo(row)" class="grid min-w-0 gap-2 focus-visible:outline-none">
          <div class="flex min-w-0 items-start justify-between gap-2">
            <span class="min-w-0 break-words font-semibold text-highlighted">{{ row.name }}</span>
            <SharedStatusBadge :tone="operationsStateTone(row.state)" :label="t(`operations.states.${row.state}`)" class="shrink-0" />
          </div>
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <SharedRecordNumber :value="row.id" />
            <span>{{ t('operations.stageCount', { count: row.steps.length }, row.steps.length) }}</span>
          </div>
        </NuxtLink>
      </template>
    </SharedDataTable>
    <template v-if="!query.error.value && items.length" #footer>
      <SharedListFooter :count-label="t('operations.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: String(value) })" />
    </template>
  </SharedListCard>
</template>
