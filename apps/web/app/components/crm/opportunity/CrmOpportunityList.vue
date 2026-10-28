<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { CrmOpportunity } from '@webvue/contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import CrmOpportunityBoard from './CrmOpportunityBoard.vue'
import { useCrmOpportunities } from '@/composables/crm/useOpportunities'
import { useCrmSourceChoices, useCrmStageChoices } from '@/composables/crm/useCrmLists'
import { useRouteListFilters } from '@/composables/useRouteListFilters'
import { activeFilterCount, CRM_LIST_PATH, isCallDue, opportunityFilters, opportunityListLocation, relativeTime, safeCrmReturnTo } from '@/utils/crmOpportunity'

// The opportunities card of the list page: the filter bar in its header, then the table or the stage board, and the
// pager. `view` is the page's `?view=` choice. `background` is the list behind the create panel: it reads its
// filters from the panel's returnTo. The page owns the SharedListPage shell.
const props = defineProps<{ view?: string; background?: boolean }>()
const PAGE_SIZE = 20
const BOARD_LIMIT = 200
const route = useRoute()
const { t, locale } = useI18n()
const { can } = useAccess()
const { hydrated, filterQuery, page, search, update } = useRouteListFilters({ background: () => props.background, fallbackPath: () => CRM_LIST_PATH, safeReturnTo: safeCrmReturnTo })

const board = computed(() => props.view === 'board')
const filters = computed(() => opportunityFilters(filterQuery.value))
const params = computed(() => ({ ...filters.value, limit: board.value ? BOARD_LIMIT : PAGE_SIZE, offset: board.value ? 0 : (page.value - 1) * PAGE_SIZE }))
const query = useCrmOpportunities(params)
const stages = useCrmStageChoices()
const sources = useCrmSourceChoices()
const items = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)
const pages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))
const count = computed(() => activeFilterCount(filterQuery.value))
const canAssign = computed(() => can('crm.leads.assign'))
const now = ref(Date.now())
const backTo = computed(() => opportunityListLocation(filterQuery.value, route.hash))
const recordTo = (item: CrmOpportunity) => ({ path: `${CRM_LIST_PATH}/${item.id}`, query: { returnTo: backTo.value } })

const ALL = 'all'
const stageItems = computed(() => [{ value: ALL, label: t('crm.opportunities.list.allStages') }, ...(stages.data.value?.items ?? []).map(stage => ({ value: String(stage.id), label: stage.name }))])
const sourceItems = computed(() => [{ value: ALL, label: t('crm.opportunities.list.allSources') }, ...(sources.data.value?.items ?? []).map(source => ({ value: String(source.id), label: source.name }))])
const choice = (value: unknown) => (value === ALL || value === undefined || value === null ? undefined : String(value))
const agent = computed({
  get: () => filters.value.user_id ?? null,
  set: (value: number | number[] | null) => { void update({ user_id: typeof value === 'number' ? String(value) : undefined, page: undefined }) },
})
const flag = (key: 'due' | 'unassigned' | 'needs_manager') => computed({
  get: () => Boolean(filters.value[key]),
  set: (on: boolean) => { void update({ [key]: on ? '1' : undefined, page: undefined }) },
})
const due = flag('due')
const unassigned = flag('unassigned')
const needsManager = flag('needs_manager')
function clearFilters() {
  search.value = ''
  void update({ q: undefined, stage_id: undefined, source_id: undefined, user_id: undefined, due: undefined, unassigned: undefined, needs_manager: undefined, page: undefined })
}

const columns = computed<TableColumn<CrmOpportunity>[]>(() => [
  { id: 'contact', header: t('crm.opportunities.form.contact'), meta: { class: { th: 'text-start min-w-[200px]', td: 'max-w-0' } } as TableColumn<CrmOpportunity>['meta'] },
  { id: 'phone', header: t('crm.opportunities.cols.phone'), meta: { class: { th: 'text-start w-[150px]', td: 'whitespace-nowrap' } } as TableColumn<CrmOpportunity>['meta'] },
  { id: 'stage', header: t('crm.opportunities.cols.stage'), meta: { class: { th: 'text-start w-[140px]', td: 'whitespace-nowrap' } } as TableColumn<CrmOpportunity>['meta'] },
  { id: 'agent', header: t('crm.opportunities.cols.agent'), meta: { class: { th: 'text-start w-[160px]', td: 'whitespace-nowrap' } } as TableColumn<CrmOpportunity>['meta'] },
  { id: 'next_call', header: t('crm.opportunities.cols.nextCall'), meta: { class: { th: 'text-start w-[200px]', td: 'whitespace-nowrap' } } as TableColumn<CrmOpportunity>['meta'] },
])
const statusLabel = (item: CrmOpportunity) => t(`crm.opportunities.status.${item.status}`)
const statusTone = (item: CrmOpportunity) => (item.status === 'won' ? 'success' : 'destructive')
</script>

<template>
  <SharedForbiddenState v-if="!can('crm.leads.read')" />
  <SharedListCard v-else-if="hydrated" :fill="board">
    <template #filters>
      <SharedFilterBar embedded class="w-full" :active-count="count" :default-open="count > 0" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <form @submit.prevent="update({ q: search.trim() || undefined, page: undefined })"><UInput v-model="search" class="w-full" icon="i-lucide-search" :placeholder="t('crm.opportunities.list.search')" :aria-label="t('crm.opportunities.list.search')" :disabled="!hydrated" /></form>
        </template>
        <USelect class="w-full md:w-44" :model-value="String(filters.stage_id ?? ALL)" :items="stageItems" :aria-label="t('crm.opportunities.list.stage')" :disabled="!hydrated" @update:model-value="value => update({ stage_id: choice(value), page: undefined })" />
        <USelect class="w-full md:w-44" :model-value="String(filters.source_id ?? ALL)" :items="sourceItems" :aria-label="t('crm.opportunities.list.source')" :disabled="!hydrated" @update:model-value="value => update({ source_id: choice(value), page: undefined })" />
        <SharedPersonPicker v-if="canAssign" v-model="agent" value-key="user_id" class="w-full md:w-52" :placeholder="t('crm.opportunities.list.agentPicker')" :aria-label="t('crm.opportunities.list.agent')" :disabled="!hydrated" />
        <USwitch v-model="due" :label="t('crm.opportunities.list.due')" :disabled="!hydrated" data-testid="crm-filter-due" />
        <template v-if="canAssign">
          <USwitch v-model="unassigned" :label="t('crm.opportunities.list.unassigned')" :disabled="!hydrated" />
          <USwitch v-model="needsManager" :label="t('crm.opportunities.list.needsManager')" :disabled="!hydrated" />
        </template>
      </SharedFilterBar>
    </template>
    <SharedPageState v-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <SharedEmptyState v-else-if="!query.isPending.value && !items.length" class="m-(--webvue-card-pad-dense)" :title="t(count ? 'app.noResults' : 'crm.opportunities.list.empty')" />
    <CrmOpportunityBoard v-else-if="board" :stages="stages.data.value?.items ?? []" :items="items" :to="recordTo" :now="now" />
    <div v-else class="min-w-0 [&_table]:w-full [&_table]:min-w-[max(100%,760px)] [&_table]:table-fixed">
      <SharedDataTable bare :rows="items" :columns="columns" row-key="id" :row-to="recordTo" :loading="query.isPending.value" :caption="t('nav.crm')">
        <template #contact-cell="{ row }">
          <span class="flex min-w-0 items-center gap-2">
            <NuxtLink :to="recordTo(row.original)" class="min-w-0 truncate font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click.stop>{{ row.original.contact_name }}</NuxtLink>
            <SharedStatusBadge v-if="row.original.status !== 'pending'" :tone="statusTone(row.original)" :label="statusLabel(row.original)" size="sm" />
            <SharedStatusBadge v-else-if="row.original.needs_manager" tone="warning" :label="t('crm.opportunities.tag.needsManager')" size="sm" />
          </span>
        </template>
        <template #phone-cell="{ row }"><a :href="`tel:${row.original.phone}`" class="text-sm hover:underline" @click.stop><bdi>{{ row.original.phone }}</bdi></a></template>
        <template #stage-cell="{ row }"><span class="text-sm">{{ row.original.stage?.name }}</span></template>
        <template #agent-cell="{ row }"><span class="text-sm" :class="{ 'text-muted': !row.original.user }">{{ row.original.user?.name ?? t('crm.opportunities.tag.pool') }}</span></template>
        <template #next_call-cell="{ row }">
          <span v-if="row.original.next_call_at" class="text-sm" :class="{ 'text-warning': isCallDue(row.original, now) }">
            <time :datetime="row.original.next_call_at" :title="formatDateTime(row.original.next_call_at)">{{ relativeTime(row.original.next_call_at, now, locale) }}</time>
          </span>
          <span v-else class="text-sm text-muted" aria-hidden="true">—</span>
        </template>
        <template #mobile-row="{ row }">
          <NuxtLink :to="recordTo(row)" class="flex min-w-0 flex-col gap-1">
            <span class="flex min-w-0 items-center gap-2"><span class="min-w-0 truncate font-semibold text-highlighted">{{ row.contact_name }}</span><SharedStatusBadge v-if="row.status !== 'pending'" :tone="statusTone(row)" :label="statusLabel(row)" size="sm" /></span>
            <span class="truncate text-sm text-muted"><bdi>{{ row.phone }}</bdi></span>
            <span class="truncate text-sm text-muted">{{ row.stage?.name }} · {{ row.user?.name ?? t('crm.opportunities.tag.pool') }}</span>
            <time v-if="row.next_call_at" class="text-sm" :class="isCallDue(row, now) ? 'text-warning' : 'text-muted'" :datetime="row.next_call_at">{{ relativeTime(row.next_call_at, now, locale) }}</time>
          </NuxtLink>
        </template>
      </SharedDataTable>
    </div>
    <template v-if="!query.error.value && items.length" #footer>
      <span v-if="board">{{ total > items.length ? t('crm.opportunities.board.capped', { count: items.length }) : t('crm.opportunities.list.results', { shown: items.length, total }) }}</span>
      <SharedListFooter v-else :count-label="t('crm.opportunities.list.results', { shown: items.length, total })" :page="page" :pages="pages" :disabled="!hydrated || query.isFetching.value" @update:page="value => update({ page: String(value) })" />
    </template>
  </SharedListCard>
</template>
