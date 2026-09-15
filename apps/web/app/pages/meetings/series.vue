<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import MeetingProjectFilter from '@/components/meetings/MeetingProjectFilter.vue'
import FilterBar from '@/components/shared/FilterBar.vue'
import { useMeetingSeriesList } from '@/composables/useMeetings'
import { returnToQuery } from '@/utils/safeReturnTo'
import { clearMeetingListFilters, parseMeetingListFilters, patchMeetingListQuery } from '@/utils/meetingListFilters'

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
const limit = 25
const offset = ref(parseOffset(route.query.offset))
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

const activeFilterCount = computed(() => [search.value.trim(), projectId.value].filter(Boolean).length)
const hasActiveFilters = computed(() => activeFilterCount.value > 0)

function parseOffset(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = typeof raw === 'string' || typeof raw === 'number' ? Number(raw) : 0
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

watch(() => route.query.q, value => {
  const next = typeof value === 'string' ? value : ''
  if (next !== search.value) search.value = next
})
watch(() => route.query.offset, value => {
  const next = parseOffset(value)
  if (next !== offset.value) offset.value = next
})
watch(debouncedSearch, (value) => {
  const next = value.trim()
  const current = routeFilters.value.q
  if (next === current) return
  if (normalizedPath.value !== '/meetings/series') return
  void router.replace({ query: patchMeetingListQuery(route.query, { q: next || undefined }) })
})
function setProject(value: number | undefined) {
  if (normalizedPath.value !== '/meetings/series') return
  void router.replace({ query: patchMeetingListQuery(route.query, { project_id: value }) })
}
function clearSearch() {
  search.value = ''
  if (normalizedPath.value !== '/meetings/series') return
  void router.replace({ query: patchMeetingListQuery(route.query, { q: undefined }) })
}
function clearFilters() {
  search.value = ''
  if (normalizedPath.value !== '/meetings/series') return
  void router.replace({ query: clearMeetingListFilters(route.query) })
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  if (normalizedPath.value !== '/meetings/series') return
  offset.value = (next - 1) * limit
  void router.replace({ query: patchMeetingListQuery(route.query, { offset: offset.value || undefined }) })
}
</script>

<template>
  <SharedPageContainer v-if="isListRoute" width="list">
    <SharedPageHeader :title="t('nav.meetingSeries')">
      <template #actions>
        <UButton v-if="can('meetings.create')" :to="{ path: '/meetings/series/new', query: returnToQuery(route.fullPath) }" :disabled="!hydrated" icon="i-lucide-plus" :label="t('meetingsUi.newSeries')" />
      </template>
    </SharedPageHeader>
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
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value?.items.length" :empty-text="t('meetingsUi.emptySeries')" @retry="query.refetch">
      <ul class="grid divide-y divide-default overflow-hidden rounded-lg bg-default ring ring-default">
        <li v-for="series in query.data.value?.items" :key="series.id">
          <NuxtLink
            :to="{ path: `/meetings/series/${series.id}`, query: returnToQuery(route.fullPath) }"
            class="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 p-4 hover:bg-elevated/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <span class="min-w-0 flex-1 break-words font-medium text-highlighted">{{ series.name }}</span>
            <span class="ms-auto text-end text-sm text-muted">{{ t(`meetingsUi.recurrence.${series.recurrence}`) }}</span>
            <span class="basis-full text-xs text-muted">
              <span v-if="series.organizer">{{ t('meetingsUi.organizer') }}: {{ series.organizer.name }}</span>
              <span v-if="series.organizer && series.project"> · </span>
              <span v-if="series.project">{{ t('meetingsUi.project') }}: {{ series.project.name }}</span>
              <span v-if="series.organizer || series.project"> · </span>
              <span>{{ t('meetingsUi.openCount', { count: series.open_resolution_count }) }}</span>
              <span> · {{ t('meetingsUi.overdueCount', { count: series.overdue_resolution_count }) }}</span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </SharedPageState>
    <SharedPagination :page="page" :pages="pages" :disabled="query.isFetching.value" @update:page="setPage" />
  </SharedPageContainer>
  <NuxtPage />
</template>
