<script setup lang="ts">
import { Plus } from '@lucide/vue'
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
  void router.replace({ query: patchMeetingListQuery(route.query, { q: next || undefined }) })
})
function setProject(value: number | undefined) {
  void router.replace({ query: patchMeetingListQuery(route.query, { project_id: value }) })
}
function clearFilters() {
  search.value = ''
  void router.replace({ query: clearMeetingListFilters(route.query) })
}
function setPage(next: number) {
  if (!hydrated.value || query.isFetching.value || next < 1 || next > pages.value) return
  offset.value = (next - 1) * limit
  void router.replace({ query: patchMeetingListQuery(route.query, { offset: offset.value || undefined }) })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('nav.meetingSeries')">
      <template #actions>
        <NuxtLink v-if="can('meetings.create')" :to="{ path: '/meetings/series/new', query: returnToQuery(route.fullPath) }">
          <Button :disabled="!hydrated" class="gap-2">
            <Plus class="size-[18px]" />{{ t('meetingsUi.newSeries') }}
          </Button>
        </NuxtLink>
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
        <div class="w-full min-w-0 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <div class="grid min-w-0 gap-1 md:col-span-2">
            <Label for="meeting-series-search">{{ t('meetingsFilters.searchSeries') }}</Label>
            <Input id="meeting-series-search" v-model="search" :disabled="!hydrated" :placeholder="t('meetingsFilters.searchSeries')" :aria-label="t('meetingsFilters.searchSeries')" />
          </div>
          <div v-if="can('pmo.projects.read')" class="grid min-w-0 gap-1">
            <Label for="meeting-series-project">{{ t('meetingsFilters.project') }}</Label>
            <MeetingProjectFilter id="meeting-series-project" hide-label :model-value="projectId" @update:model-value="setProject" @resolved-name="projectName = $event" />
          </div>
        </div>
        <template v-if="hasActiveFilters" #active>
          <div class="flex flex-wrap items-center gap-2">
            <Badge v-if="search.trim()" variant="secondary">{{ t('meetingsUi.searchValue', { value: search }) }}</Badge>
            <Badge v-if="projectId" variant="secondary" class="gap-1">{{ projectName || t('meetingsFilters.selectedProject') }}<button type="button" :aria-label="t('meetingsFilters.removeFilter')" @click="setProject(undefined)">×</button></Badge>
          </div>
        </template>
      </FilterBar>
      <span class="text-sm text-muted-foreground" role="status">{{ totalLabel }}</span>
    </div>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value?.items.length" :empty-text="t('meetingsUi.emptySeries')" @retry="query.refetch">
      <div class="nasq-panel overflow-hidden">
        <NuxtLink
          v-for="series in query.data.value?.items"
          :key="series.id"
          :to="{ path: `/meetings/series/${series.id}`, query: returnToQuery(route.fullPath) }"
          class="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 border-b border-border/80 p-4 last:border-0 hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span class="min-w-0 flex-1 font-medium break-words">{{ series.name }}</span>
          <span class="ms-auto text-end text-sm text-muted-foreground">{{ t(`meetingsUi.recurrence.${series.recurrence}`) }}</span>
          <span class="basis-full text-xs text-muted-foreground">
            <span v-if="series.organizer">{{ t('meetingsUi.organizer') }}: {{ series.organizer.name }}</span>
            <span v-if="series.organizer && series.project"> · </span>
            <span v-if="series.project">{{ t('meetingsUi.project') }}: {{ series.project.name }}</span>
            <span v-if="(series.organizer || series.project) && (series.open_resolution_count || series.overdue_resolution_count)"> · </span>
            <span>{{ t('meetingsUi.openCount', { count: series.open_resolution_count }) }}</span>
            <span> · {{ t('meetingsUi.overdueCount', { count: series.overdue_resolution_count }) }}</span>
          </span>
        </NuxtLink>
      </div>
    </SharedPageState>
    <nav v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
      <Button variant="ghost" :disabled="!hydrated || page === 1 || query.isFetching.value" @click="setPage(page - 1)">
        {{ t('projects.previousPage') }}
      </Button>
      <span>{{ t('meetingsUi.pageOf', { page, pages }) }}</span>
      <Button variant="ghost" :disabled="!hydrated || page >= pages || query.isFetching.value" @click="setPage(page + 1)">
        {{ t('projects.nextPage') }}
      </Button>
    </nav>
  </SharedPageContainer>
</template>
