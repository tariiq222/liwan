<script setup lang="ts">
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { PROJECT_CHANGE_STATES } from '@liwan/contracts'
import { changeFilters } from '@/composables/projectChangeKeys'
import { useChangeCategories, useProjectChanges } from '@/composables/useProjectChanges'
import { useGovernancePaging } from '@/components/pmo/projects/governance/listPaging'
import { CHANGE_STATE_TONE } from '@/components/pmo/projects/changes/state'
import ProjectNotFoundState from '@/components/pmo/projects/ProjectNotFoundState.vue'
import { useProjectMissing } from '@/composables/useProjects'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { formatMoney } from '@/utils/projectFinance'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const id = computed(() => Number(route.params.id))
const isListRoute = computed(() => {
  const rest = (route.path.replace(/\/+$/, '') || '/').replace(/^\/projects\/[^/]+\/changes/, '')
  return rest === '' || rest === '/new'
})
const parsed = computed(() => changeFilters(route.query))
const list = useProjectChanges(computed(() => isListRoute.value ? id.value : null), parsed)
const categories = useChangeCategories()
const notFound = useProjectMissing(id)
const { pageNumber, pages, setPage } = useGovernancePaging(list, computed(() => parsed.value.offset ?? 0), isListRoute, { route, router, hydrated })

function setFilter(key: string, value: unknown) {
  const text = value === 'all' ? '' : String(value ?? '')
  void router.replace({ query: { ...route.query, [key]: text || undefined, offset: undefined } })
}
const stateFilter = computed(() => parsed.value.state ?? 'all')
const categoryFilter = computed(() => parsed.value.category_id ? String(parsed.value.category_id) : 'all')
const activeFilterCount = computed(() => Number(Boolean(parsed.value.state)) + Number(Boolean(parsed.value.category_id)))
function clearFilters() {
  void router.replace({ query: { ...route.query, state: undefined, category_id: undefined, offset: undefined } })
}
const stateItems = computed(() => [
  { value: 'all', label: t('projects.changes.allStates') },
  ...PROJECT_CHANGE_STATES.map(value => ({ value, label: t(`projects.changes.state.${value}`) })),
])
const categoryItems = computed(() => [
  { value: 'all', label: t('projects.changes.allCategories') },
  ...(categories.data.value?.items ?? []).map(category => ({ value: String(category.id), label: category.name })),
])

// A link out of the list carries the list's own state, so Back returns to the same filtered page.
const liveQuery = computed(() => {
  const { returnTo: _referrer, ...rest } = route.query
  return rest
})
const itemTo = (item: { id: number }) => ({ path: `/projects/${id.value}/changes/${item.id}`, query: liveQuery.value })
const createTo = computed(() => list.data.value?.can_create ? { path: `/projects/${id.value}/changes/new`, query: liveQuery.value } : undefined)

const columns = computed(() => [
  { accessorKey: 'number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2', td: 'w-12 px-2' } } },
  { accessorKey: 'title', header: t('projects.changes.fields.title'), meta: { class: { th: 'min-w-56', td: 'max-w-0 min-w-56 truncate' } } },
  { id: 'category', header: t('projects.changes.fields.category'), meta: { class: { th: 'w-32', td: 'w-32 truncate' } } },
  { accessorKey: 'state', header: t('projects.changes.fields.state'), meta: { class: { th: 'w-32', td: 'w-32' } } },
  { id: 'days', header: t('projects.changes.fields.scheduleDays'), meta: { class: { th: 'w-24', td: 'w-24 whitespace-nowrap' } } },
  { id: 'cost', header: t('projects.changes.fields.cost'), meta: { class: { th: 'w-32 text-end', td: 'w-32 text-end whitespace-nowrap' } } },
  { id: 'requester', header: t('projects.changes.fields.requester'), meta: { class: { th: 'w-28', td: 'w-28' } } },
])
const items = computed(() => list.data.value?.items ?? [])
const total = computed(() => list.data.value?.total ?? 0)
const bareEmpty = computed(() => Boolean(list.data.value) && !items.value.length && !activeFilterCount.value && !parsed.value.offset)
const days = (value: number) => value === 0 ? '0' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`
</script>

<template>
  <ProjectNotFoundState v-if="isListRoute && notFound" />
  <SharedListPage
    v-else-if="isListRoute"
    hide-header
    :title="t('projects.changes.title')"
    :create-to="createTo"
    :create-label="t('projects.changes.create')"
    create-test-id="change-create"
  >
    <SharedEmptyState v-if="bareEmpty" bordered :title="t('projects.changes.empty')" :description="t('projects.changes.emptyHint')" />
    <SharedListCard v-else>
      <template #filters>
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
          <template #default>
            <USelect class="w-full md:w-44" icon="i-lucide-activity" :items="stateItems" :model-value="stateFilter" :disabled="!hydrated" :aria-label="t('projects.changes.fields.state')" @update:model-value="setFilter('state', $event)" />
            <USelect class="w-full md:w-44" icon="i-lucide-tag" :items="categoryItems" :model-value="categoryFilter" :disabled="!hydrated" :aria-label="t('projects.changes.fields.category')" @update:model-value="setFilter('category_id', $event)" />
          </template>
        </FilterBar>
      </template>
      <SharedPageState v-if="list.error.value" :error="list.error.value" @retry="list.refetch" />
      <div v-else-if="!list.isLoading.value && !items.length" class="p-(--liwan-card-pad)">
        <SharedEmptyState :title="t('projects.clarity.filteredEmpty')" />
      </div>
      <SharedDataTable v-else bare :rows="items" :columns="columns" row-key="id" :row-to="itemTo" :loading="list.isLoading.value" :caption="t('projects.changes.title')">
        <template #number-cell="{ row }"><RecordNumber :value="row.original.number" /></template>
        <template #title-cell="{ row }">
          <NuxtLink :to="itemTo(row.original)" class="block truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{{ row.original.title }}</NuxtLink>
        </template>
        <template #category-cell="{ row }">{{ row.original.category?.name ?? '—' }}</template>
        <template #state-cell="{ row }"><SharedStatusBadge :tone="CHANGE_STATE_TONE[row.original.state]" :label="t(`projects.changes.state.${row.original.state}`)" /></template>
        <template #days-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ days(row.original.impact_schedule_days) }}</span></template>
        <template #cost-cell="{ row }">
          <span v-if="row.original.currency" dir="ltr" class="tabular-nums">{{ formatMoney(row.original.impact_cost, row.original.currency) }}</span>
          <span v-else dir="ltr" class="tabular-nums">{{ row.original.impact_cost }}</span>
        </template>
        <template #requester-cell="{ row }"><SharedPersonAvatar :people="[row.original.requester]" /></template>
        <template #mobile-row="{ row: item }">
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 space-y-1">
                <RecordNumber :value="item.number" />
                <NuxtLink :to="itemTo(item)" class="block font-semibold text-highlighted hover:underline">{{ item.title }}</NuxtLink>
              </div>
              <SharedStatusBadge :tone="CHANGE_STATE_TONE[item.state]" :label="t(`projects.changes.state.${item.state}`)" />
            </div>
            <dl class="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
              <div><dt class="text-xs text-muted">{{ t('projects.changes.fields.category') }}</dt><dd>{{ item.category?.name ?? '—' }}</dd></div>
              <div><dt class="text-xs text-muted">{{ t('projects.changes.fields.scheduleDays') }}</dt><dd dir="ltr" class="tabular-nums">{{ days(item.impact_schedule_days) }}</dd></div>
              <div><dt class="text-xs text-muted">{{ t('projects.changes.fields.cost') }}</dt><dd dir="ltr" class="tabular-nums">{{ item.currency ? formatMoney(item.impact_cost, item.currency) : item.impact_cost }}</dd></div>
            </dl>
          </div>
        </template>
      </SharedDataTable>
      <template v-if="!list.error.value && items.length" #footer>
        <SharedListFooter :count-label="t('projects.footer.results', { shown: items.length, total }, total)" count-test-id="change-result-count" :page="pageNumber" :pages="pages" :disabled="list.isFetching.value" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
