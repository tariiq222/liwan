<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { MeetingSeriesListItem } from '@liwan/contracts'
import { refDebounced } from '@vueuse/core'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import FilterBar from '@liwan/ui/app/components/shared/data/FilterBar.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { useMeetingListQuerySync } from '@/composables/useMeetingListQuerySync'
import { useMeetingSeriesList } from '@/composables/useMeetings'
import { useMeetingSeriesKpis } from '@/composables/useMeetingKpis'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery } from '@/utils/meetingListFilters'
import { parseOffset } from '@/utils/routeQuery'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { shown: kpisShown } = useKpiVisibility()
const { can } = useAccess()
const hasProjectFilter = useRecordPickerAvailable('project')
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
  onNavigationStart: handler => useNuxtApp().hook('liwan:navigation:start', handler),
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
// Global figures: the series list has no server filter for resolutions, so none of the tiles follows the search or project filter.
const kpis = useMeetingSeriesKpis(kpisShown)
const page = computed(() => Math.floor(offset.value / limit) + 1)
const pages = computed(() => Math.max(1, Math.ceil((query.data.value?.total ?? 0) / limit)))
const rows = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.total ?? 0)

const columns = computed<TableColumn<MeetingSeriesListItem>[]>(() => [
  { id: 'record_number', header: () => recordNumberHeader(t), meta: { class: { th: 'w-12 px-2 text-start', td: 'w-12 px-2 whitespace-nowrap' } } },
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
    kpi-toggle
    @click.capture="openCreate"
  >
    <SharedKpiStrip v-if="hydrated" :tiles="kpis.tiles.value" :loading="kpis.loading.value" :label="t('meetingsKpi.label')" :skeleton-count="3" data-testid="meeting-series-kpi-strip" />
    <SharedListCard>
      <template #filters>
        <FilterBar embedded class="w-full" :active-count="activeFilterCount" :clear-label="t('meetingsUi.clear')" :disabled="!hydrated" @clear="clearFilters">
          <template #search>
            <UInput id="meeting-series-search" v-model="search" icon="i-lucide-search" class="w-full" :disabled="!hydrated" :placeholder="t('meetingsFilters.searchSeries')" :aria-label="t('meetingsFilters.searchSeries')">
              <template v-if="search" #trailing>
                <UButton type="button" color="neutral" variant="link" size="sm" icon="i-lucide-x" :aria-label="t('meetingsFilters.clearSearch')" class="-me-1" @click="clearSearch" />
              </template>
            </UInput>
          </template>
          <template v-if="hasProjectFilter" #default>
            <MeetingProjectFilter id="meeting-series-project" hide-label class="w-full md:w-44" :model-value="projectId" @update:model-value="setProject" @resolved-name="projectName = $event" />
          </template>
        </FilterBar>
      </template>
      <SharedDataTable
        bare
        :rows="rows"
        :columns="columns"
        row-key="id"
        :row-to="seriesTo"
        :loading="query.isLoading.value"
        :error="query.error.value"
        :empty-text="t(activeFilterCount ? 'app.noResults' : 'meetingsUi.emptySeries')"
        :caption="t('nav.meetingSeries')"
        @retry="query.refetch()"
      >
        <template #record_number-cell="{ row }"><RecordNumber :value="row.original.id" /></template>
        <template #name-cell="{ row }">
          <NuxtLink :to="seriesTo(row.original)" class="block min-w-0 truncate text-base font-semibold text-highlighted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" @click.capture="openRecord($event, row.original)">{{ row.original.name }}</NuxtLink>
        </template>
        <template #recurrence-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <SharedStatusBadge tone="neutral" icon="i-lucide-repeat" :label="t(`meetingsUi.recurrence.${row.original.recurrence}`)" />
            <SharedStatusBadge v-if="!row.original.active" tone="neutral" icon="i-lucide-circle-slash" :label="t('meetingsUx.seriesEnded')" data-testid="meeting-series-ended-badge" />
          </div>
        </template>
        <template #organizer-cell="{ row }">
          <div v-if="row.original.organizer" class="flex min-w-0 items-center gap-2"><SharedPersonAvatar :people="[row.original.organizer]" /><span class="min-w-0 truncate text-muted">{{ row.original.organizer.name }}</span></div>
          <span v-else class="text-muted">—</span>
        </template>
        <template #project-cell="{ row }"><span class="text-muted">{{ row.original.project?.name || '—' }}</span></template>
        <template #open_resolution_count-cell="{ row }">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-muted">{{ t('meetingsUi.openCount', { count: row.original.open_resolution_count }, row.original.open_resolution_count) }}</span>
            <SharedStatusBadge v-if="row.original.overdue_resolution_count" tone="destructive" :label="t('meetingsUi.overdueCount', { count: row.original.overdue_resolution_count })" />
          </div>
        </template>
        <template #mobile-row="{ row: series }">
          <NuxtLink :to="seriesTo(series)" @click.capture="openRecord($event, series)" class="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 focus-visible:outline-none">
            <span class="min-w-0 flex-1 break-words font-semibold text-highlighted">{{ series.name }}</span>
            <span class="ms-auto text-end text-sm text-muted">{{ t(`meetingsUi.recurrence.${series.recurrence}`) }}<template v-if="!series.active"> · {{ t('meetingsUx.seriesEnded') }}</template></span>
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
      <template v-if="!query.error.value && rows.length" #footer>
        <SharedListFooter :count-label="t('meetingsUi.footer.results', { shown: rows.length, total }, total)" count-test-id="meeting-series-result-count" :page="page" :pages="pages" :disabled="query.isFetching.value || !hydrated" @update:page="setPage" />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
