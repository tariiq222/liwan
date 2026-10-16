<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingSeriesListItem } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import FilterBar from '@nasq/ui/app/components/shared/data/FilterBar.vue'
import { useMeetingListQuerySync } from '@/composables/useMeetingListQuerySync'
import { useMeetingSeriesList } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery } from '@/utils/meetingListFilters'
import { parseOffset } from '@/utils/routeQuery'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const normalizedPath = computed(() => route.path.replace(/\/+$/, '') || '/')
const isListRoute = computed(() => {
  const rest = normalizedPath.value.replace(/^\/meetings\/series/, '')
  return rest === '' || rest === '/new'
})
const routeFilters = computed(() => parseMeetingListFilters(route.query))
const search = ref(routeFilters.value.q)
const debouncedSearch = refDebounced(search, 250)

const listPath = '/meetings/series'
const limit = 25
const offset = ref(parseOffset(route.query.offset))
const { isCurrentList, liveListQuery, liveReturnTo, replaceListQuery, isPlainClick } = useMeetingListQuerySync({
  router,
  route,
  listPath,
  search,
  debouncedSearch,
  offset,
  onNavigationStart: handler => useNuxtApp().hook('nasq:navigation:start', handler),
})
function openRecord(event: MouseEvent, record: { id: number }) {
  if (!hydrated.value || !isCurrentList() || !isPlainClick(event)) return
  event.preventDefault()
  void router.push(seriesTo(record)).catch(() => undefined)
}
function openCreate(event: MouseEvent) {
  if (!can('meetings.create') || !hydrated.value || !isCurrentList() || !isPlainClick(event)) return
  if (!(event.target as Element | null)?.closest('[data-testid="meeting-series-new"]')) return
  event.preventDefault()
  void router.push({ path: `${listPath}/new`, query: returnToQuery(liveReturnTo()) }).catch(() => undefined)
}

const projectId = computed(() => routeFilters.value.projectId)
const projectName = ref('')
const params = computed(() => ({
  q: debouncedSearch.value.trim() || undefined,
  ...(projectId.value ? { project_id: projectId.value } : {}),
  limit,
  offset: offset.value,
}))
const query = useMeetingSeriesList(params)
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const totalLabel = computed(() => query.isLoading.value
  ? t('meetingsUx.countLoading')
  : query.error.value
    ? t('meetingsUx.countUnavailable')
    : t('meetingsUi.totalSeries', { count: query.data.value?.total ?? 0 }))

const columns = computed<TableColumn<MeetingSeriesListItem>[]>(() => [
  { accessorKey: 'name', header: t('meetingsUx.seriesName') },
  { accessorKey: 'recurrence', header: t('meetingsUi.recurrenceLabel') },
  { accessorKey: 'organizer', header: t('meetingsUi.organizer') },
  { accessorKey: 'project', header: t('meetingsUi.project') },
  { accessorKey: 'open_resolution_count', header: t('meetingsUi.resolutions') },
])

function seriesTo(series: { id: number }) {
  return { path: `/meetings/series/${series.id}`, query: returnToQuery(liveReturnTo()) }
}

const createTo = computed(() => ({ path: '/meetings/series/new', query: returnToQuery(liveReturnTo()) }))

const activeFilterCount = computed(() => [search.value.trim(), projectId.value].filter(Boolean).length)
const hasActiveFilters = computed(() => activeFilterCount.value > 0)

function setProject(value: number | undefined) {
  if (!isCurrentList()) return
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), { project_id: value }))
}
function clearSearch() {
  search.value = ''
  if (!isCurrentList()) return
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), { q: undefined }))
}
function clearFilters() {
  search.value = ''
  if (!isCurrentList()) return
  void replaceListQuery(clearMeetingListFilters(liveListQuery()))
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  if (!isCurrentList()) return
  offset.value = (next - 1) * limit
  void replaceListQuery(patchMeetingListQuery(liveListQuery(), { offset: offset.value || undefined }))
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('nav.meetingSeries')"
    :create-to="can('meetings.create') ? createTo : undefined"
    :create-label="t('meetingsUi.newSeries')"
    create-test-id="meeting-series-new"
    @click.capture="openCreate"
  >
    <template #filters>
      <div class="w-full min-w-0">
        <FilterBar
          :title="t('filterCard.title')"
          :active-count="activeFilterCount"
          :clear-label="t('meetingsUi.clear')"
          :disabled="!hydrated"
          @clear="clearFilters"
        >
          <template #search>
            <UInput id="meeting-series-search" v-model="search" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsFilters.searchSeries')" :aria-label="t('meetingsFilters.searchSeries')" />
          </template>
          <template v-if="can('pmo.projects.read')" #default>
            <SharedFilterField :label="t('meetingsFilters.project')" for="meeting-series-project">
              <MeetingProjectFilter id="meeting-series-project" hide-label class="w-full" :model-value="projectId" @update:model-value="setProject" @resolved-name="projectName = $event" />
            </SharedFilterField>
          </template>
          <template v-if="hasActiveFilters" #active>
            <div class="flex flex-wrap items-center gap-2">
              <SharedFilterChip v-if="search.trim()" :label="t('meetingsUi.searchValue', { value: search })" @remove="clearSearch" />
              <SharedFilterChip v-if="projectId" :label="projectName || t('meetingsFilters.selectedProject')" @remove="setProject(undefined)" />
            </div>
          </template>
        </FilterBar>

        <span class="text-sm text-muted" role="status">{{ totalLabel }}</span>
      </div>
    </template>
    <SharedDataTable
      :rows="query.data.value?.items ?? []"
      :columns="columns"
      row-key="id"
      :row-to="seriesTo"
      :loading="query.isLoading.value"
      :error="query.error.value"
      :empty-text="t('meetingsUi.emptySeries')"
      :caption="t('nav.meetingSeries')"
      :page="page"
      :pages="pages"
      @update:page="setPage"
      @retry="query.refetch()"
    >
      <template #name-cell="{ row }">
        <NuxtLink :to="seriesTo(row.original)" class="rounded font-medium text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click.capture="openRecord($event, row.original)">{{ row.original.name }}</NuxtLink>
      </template>
      <template #recurrence-cell="{ row }">{{ t(`meetingsUi.recurrence.${row.original.recurrence}`) }}</template>
      <template #organizer-cell="{ row }">{{ row.original.organizer?.name || '—' }}</template>
      <template #project-cell="{ row }">{{ row.original.project?.name || '—' }}</template>
      <template #open_resolution_count-cell="{ row }">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }, row.original.open_resolution_count) }} · {{ t('meetingsUi.overdueCount', { count: row.original.overdue_resolution_count }) }}</template>
      <template #mobile-row="{ row: series }">
        <NuxtLink :to="seriesTo(series)" @click.capture="openRecord($event, series)" class="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 focus-visible:outline-none">
          <span class="min-w-0 flex-1 break-words font-medium text-highlighted">{{ series.name }}</span>
          <span class="ms-auto text-end text-sm text-muted">{{ t(`meetingsUi.recurrence.${series.recurrence}`) }}</span>
          <span class="basis-full text-xs text-muted">
            <span v-if="series.organizer">{{ t('meetingsUi.organizer') }}: {{ series.organizer.name }}</span>
            <span v-if="series.organizer && series.project"> · </span>
            <span v-if="series.project">{{ t('meetingsUi.project') }}: {{ series.project.name }}</span>
            <span v-if="series.organizer || series.project"> · </span>
            <span>{{ t('meetingsUi.openCount', { count: series.open_resolution_count }, series.open_resolution_count) }}</span>
            <span> · {{ t('meetingsUi.overdueCount', { count: series.overdue_resolution_count }) }}</span>
          </span>
        </NuxtLink>
      </template>
    </SharedDataTable>
  </SharedListPage>
  <NuxtPage />
</template>
