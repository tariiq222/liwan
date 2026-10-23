<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { OperationRequestSummary } from '@webvue/contracts'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { useOperationRequests, operationRequestListParams, type OperationScope } from '@/composables/operations/useOperations'
import { operationListLocation, safeOperationReturnTo, operationStateChoices, operationStateFromSelection } from '@/composables/operations/forms'
import { operationsStateTone } from '@/composables/operations/state'
import { useRouteListFilters } from '@/composables/useRouteListFilters'

// One of the three request lists (mine, pending my approval, monitoring) on the list template: a card with the search and
// the state filter in its header row, a bare table and the result count with the pager. `background` is the list behind
// the create panel: it reads its filters from the panel's returnTo. The page owns the SharedListPage shell.
const props = defineProps<{ scope: OperationScope; personal?: boolean; background?: boolean }>()
const PAGE_SIZE = 20
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const path = computed(() => props.personal ? '/account/requests' : props.scope === 'mine' ? '/operations' : `/operations/${props.scope}`)
const { hydrated, filterQuery, page, search, committedSearch, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => path.value, safeReturnTo: safeOperationReturnTo })
const allowed = computed(() => can(props.scope === 'pending' ? 'operations.requests.review' : props.scope === 'monitoring' ? 'operations.monitoring.read' : 'operations.requests.read'))
const selectedState = computed(() => operationStateFromSelection(filterQuery.value.state))
const params = computed(() => ({ ...operationRequestListParams(props.scope, props.personal), q: committedSearch.value || undefined, state: selectedState.value || undefined, limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE }))
const query = useOperationRequests(params, allowed)
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const backTo = computed(() => operationListLocation(path.value, route.query, route.hash))
const requestTo = (item: OperationRequestSummary) => ({ path: `${props.personal ? '/account/requests' : '/operations'}/${item.id}`, query: { returnTo: backTo.value } })
const stateItems = computed(() => operationStateChoices(t))
const activeCount = computed(() => Number(!!committedSearch.value) + Number(!!selectedState.value))
const hasFilters = computed(() => activeCount.value > 0)
function clearFilters() {
  search.value = ''
  void update({ q: undefined, state: undefined, page: undefined })
}

const WIDTH = {
  number: 'w-[48px] min-w-[48px] px-2',
  title: 'min-w-[240px]',
  process: 'w-[18%] min-w-[160px]',
  requester: 'w-[152px] min-w-[152px]',
  state: 'w-[144px] min-w-[144px]',
  date: 'w-[128px] min-w-[128px]',
}
function column(id: string, header: TableColumn<OperationRequestSummary>['header'], width: string, fit = false): TableColumn<OperationRequestSummary> {
  const cell = fit ? 'whitespace-nowrap' : 'max-w-0 overflow-hidden text-ellipsis whitespace-nowrap'
  return { id, header, meta: { class: { th: `text-start ${width}`, td: `${cell} ${width}` } } as TableColumn<OperationRequestSummary>['meta'] }
}
const columns = computed<TableColumn<OperationRequestSummary>[]>(() => [
  column('record_number', () => recordNumberHeader(t), WIDTH.number, true),
  column('name', t('operations.name'), WIDTH.title),
  column('process', t('operations.process'), WIDTH.process),
  ...(!props.personal ? [column('requester', t('operations.requester'), WIDTH.requester, true)] : []),
  column('state', t('operations.state'), WIDTH.state, true),
  column('created_at', t('operations.createdAt'), WIDTH.date, true),
])
</script>

<template>
  <SharedForbiddenState v-if="!allowed" :description="t('operations.errors.forbidden')" />
  <SharedListCard v-else-if="hydrated">
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="activeCount" :default-open="!!selectedState" :disabled="!hydrated" @clear="clearFilters">
        <template #search><form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })"><UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('operations.searchRequests')" :aria-label="t('operations.searchRequests')" :disabled="!hydrated" /></form></template>
        <USelect class="w-full md:w-48" :model-value="selectedState ?? 'all'" :items="stateItems" :aria-label="t('operations.state')" :disabled="!hydrated" @update:model-value="value => update({ state: operationStateFromSelection(value), page: undefined })" />
      </SharedFilterBar>
    </template>
    <SharedPageState v-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--webvue-card-pad-dense)" :title="t(hasFilters ? 'app.noResults' : 'operations.emptyRequests')" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,792px)] [&_table]:table-fixed">
      <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="requestTo" :loading="query.isPending.value" :caption="t(personal ? 'operations.personal.title' : `operations.nav.${scope}`)">
        <template #record_number-cell="{ row }"><SharedRecordNumber :value="row.original.id" /></template>
        <template #name-cell="{ row }">
          <NuxtLink :to="requestTo(row.original)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" :title="row.original.name" @click.stop>{{ row.original.name }}</NuxtLink>
        </template>
        <template #process-cell="{ row }"><span class="text-muted">{{ row.original.process.name }}</span></template>
        <template #requester-cell="{ row }">
          <span class="inline-flex min-w-0 items-center gap-2"><SharedPersonAvatar :people="[row.original.requester]" /><span class="min-w-0 truncate text-sm">{{ row.original.requester.name }}</span></span>
        </template>
        <template #state-cell="{ row }"><SharedStatusBadge :tone="operationsStateTone(row.original.state)" :label="t(`operations.states.${row.original.state}`)" /></template>
        <template #created_at-cell="{ row }"><time class="text-sm text-muted" :datetime="row.original.created_at">{{ formatDate(row.original.created_at) }}</time></template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="requestTo(row)" class="flex min-w-0 flex-col gap-2">
            <span class="flex min-w-0 items-center gap-2"><SharedRecordNumber :value="row.id" /><span class="min-w-0 truncate font-semibold text-highlighted">{{ row.name }}</span></span>
            <span class="truncate text-sm text-muted">{{ row.process.name }} · {{ row.requester.name }}</span>
            <span class="flex items-center justify-between gap-2"><SharedStatusBadge :tone="operationsStateTone(row.state)" :label="t(`operations.states.${row.state}`)" /><time class="text-sm text-muted" :datetime="row.created_at">{{ formatDate(row.created_at) }}</time></span>
          </NuxtLink>
        </template>
      </SharedDataTable>
    </div>
    <template v-if="!query.error.value && items.length" #footer>
      <SharedListFooter :count-label="t('operations.footer.results', { shown: items.length, total }, total)" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: String(value) })" />
    </template>
  </SharedListCard>
</template>
