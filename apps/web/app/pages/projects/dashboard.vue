<script setup lang="ts">
import { PROJECT_STATUSES } from '@webvue/contracts'
import { refDebounced } from '@vueuse/core'
import type { RouteLocationNormalized } from 'vue-router'
import FilterBar from '@webvue/ui/app/components/shared/data/FilterBar.vue'
import ProjectDashboardCharts from '@/components/pmo/projects/dashboard/ProjectDashboardCharts.vue'
import PendingCharterReviews from '@/components/pmo/projects/dashboard/PendingCharterReviews.vue'
import ProjectDashboardMetrics from '@/components/pmo/projects/dashboard/ProjectDashboardMetrics.vue'
import ProjectDashboardRecentProjects from '@/components/pmo/projects/dashboard/ProjectDashboardRecentProjects.vue'
import { useProjectDashboardAnalytics } from '@/composables/useProjectDashboardAnalytics'
import { parseReportStatus, type ProjectReportStatusFilter } from '@/utils/projectFinance'

type DashboardRouteState = { q: string; status: ProjectReportStatusFilter }

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()

function queryText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function parseRoute(query: Record<string, unknown>): DashboardRouteState {
  return { q: queryText(query.q), status: parseReportStatus(query.status) }
}

function serializeRoute(state: DashboardRouteState) {
  return { q: state.q.trim() || undefined, status: state.status === 'all' ? undefined : state.status }
}

function sameRoute(left: ReturnType<typeof serializeRoute>, right: ReturnType<typeof serializeRoute>) {
  return left.q === right.q && left.status === right.status
}

const filters = reactive<DashboardRouteState>(parseRoute(route.query as Record<string, unknown>))
const search = ref(filters.q)
const debouncedSearch = refDebounced(search, 250)
let applyingRoute = false
let writeQuery: Promise<void> = Promise.resolve()
let pendingNavigation: RouteLocationNormalized | null = null
let disposed = false
let pendingOwnQuery: { target: string; navigation: RouteLocationNormalized | null } | null = null
const dashboardPath = '/projects/dashboard'
const isDashboard = () => router.currentRoute.value.path.replace(/\/+$/, '') === dashboardPath

function resumeListWrites() {
  pendingNavigation = null
  // A failed own replacement must wait for a later edit, rather than retry itself.
  if (!applyingRoute && isDashboard()) scheduleQueryWrite()
}

const removeNavigationStart = useNuxtApp().hook('webvue:navigation:start', to => {
  pendingNavigation = to
  if (pendingOwnQuery && !pendingOwnQuery.navigation && to.fullPath === pendingOwnQuery.target) pendingOwnQuery.navigation = to
})
const removeAfterEach = router.afterEach((to, _from, failure) => {
  if (to !== pendingNavigation) return
  if (!failure && applyingRoute && isDashboard() && to !== pendingOwnQuery?.navigation) {
    pendingOwnQuery = null
    const parsed = parseRoute(to.query as Record<string, unknown>)
    search.value = parsed.q
    Object.assign(filters, parsed)
  }
  resumeListWrites()
})
const removeOnError = router.onError((_error, to) => {
  if (to === pendingNavigation) resumeListWrites()
})
onScopeDispose(() => {
  disposed = true
  removeNavigationStart()
  removeAfterEach()
  removeOnError()
})

const analyticsFilters = computed(() => ({
  q: filters.q.trim() || undefined,
  status: filters.status,
}))
const analytics = useProjectDashboardAnalytics(analyticsFilters)
const rows = computed(() => analytics.data.value?.projects ?? [])
const recentRows = computed(() => analytics.data.value?.recent_projects ?? [])
const filtered = computed(() => Boolean(filters.q.trim()) || filters.status !== 'all')
const activeFilterCount = computed(() => Number(Boolean(filters.q.trim())) + Number(filters.status !== 'all'))
// Loading until hydrated keeps the first client render equal to SSR (the query may finish before hydration).
const loadingState = computed(() => !hydrated.value || (analytics.isLoading.value && !analytics.data.value))
const hasRows = computed(() => !loadingState.value && !analytics.error.value && rows.value.length > 0)

function applyPatch(patch: Partial<DashboardRouteState>) {
  Object.assign(filters, {
    q: patch.q ?? filters.q,
    status: parseReportStatus(patch.status ?? filters.status),
  })
}

function scheduleQueryWrite() {
  writeQuery = writeQuery.then(async () => {
    if (disposed || pendingNavigation || !isDashboard()) return
    const query = serializeRoute(filters)
    const writeStartedAt = router.currentRoute.value
    const current = serializeRoute(parseRoute(writeStartedAt.query as Record<string, unknown>))
    if (sameRoute(query, current)) return
    applyingRoute = true
    let writeSucceeded = false
    const writeTarget = { target: router.resolve({ query, hash: writeStartedAt.hash }).fullPath, navigation: null as RouteLocationNormalized | null }
    pendingOwnQuery = writeTarget
    try {
      writeSucceeded = !(await router.replace({ query, hash: writeStartedAt.hash }))
    } finally {
      applyingRoute = false
      const currentRoute = router.currentRoute.value
      const ownsDraft = pendingOwnQuery === writeTarget
      if (ownsDraft) pendingOwnQuery = null
      // A newer external list owns controls once committed; an older write cannot reset later edits.
      if (!disposed && ownsDraft && !writeSucceeded && currentRoute !== writeStartedAt && isDashboard()) {
        const parsed = parseRoute(currentRoute.query as Record<string, unknown>)
        search.value = parsed.q
        Object.assign(filters, parsed)
      }
    }
  }).catch(() => undefined)
}

watch(debouncedSearch, value => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch([() => filters.q, () => filters.status], scheduleQueryWrite)
watch(() => route.query, query => {
  if (applyingRoute) return
  const parsed = parseRoute(query as Record<string, unknown>)
  if (sameRoute(serializeRoute(filters), serializeRoute(parsed))) return
  applyingRoute = true
  search.value = parsed.q
  Object.assign(filters, parsed)
  queueMicrotask(() => { applyingRoute = false })
})

function onStatusChange(value: unknown) {
  applyPatch({ status: parseReportStatus(value) })
}

function clearFilters() {
  search.value = ''
  applyPatch({ q: '', status: 'all' })
}

function clearSearch() {
  search.value = ''
  applyPatch({ q: '' })
}

const statusOptions = computed(() => [
  { value: 'all', label: t('projects.filters.allStatuses') },
  { value: 'unset', label: t('projects.status.unset') },
  ...PROJECT_STATUSES.map(status => ({ value: status, label: t(`projects.status.${status}`) })),
])
const statusLabel = computed(() => t(filters.status === 'unset' ? 'projects.filters.unset' : `projects.status.${filters.status}`))
</script>

<template>
  <SharedDashboardPage :title="t('projects.dashboard.title')" kpi-toggle data-testid="project-dashboard-page">
    <template #filters>
      <FilterBar embedded class="w-full" :title="t('filterCard.title')" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.reports.search')" :aria-label="t('projects.reports.search')" icon="i-lucide-search" class="min-w-52 flex-1" />
        </template>
        <template #default>
          <SharedFilterChoice
            data-testid="project-dashboard-status-filter"
            :label="t('projects.filters.statusLabel')"
            :items="statusOptions"
            :model-value="filters.status"
            :disabled="!hydrated"
            @update:model-value="onStatusChange"
          />
        </template>
        <template #active>
          <div v-if="filtered" class="flex flex-wrap items-center gap-2">
            <SharedFilterChip v-if="filters.q.trim()" :label="t('projects.filters.searchValue', { value: filters.q })" @remove="clearSearch" />
            <SharedFilterChip v-if="filters.status !== 'all'" :label="statusLabel" @remove="onStatusChange('all')" />
          </div>
        </template>
      </FilterBar>
    </template>

    <template #primary>
      <PendingCharterReviews />
    </template>

    <template v-if="hasRows" #metrics>
      <ProjectDashboardMetrics :rows="rows" />
    </template>

    <SharedLoadingSkeleton v-if="loadingState" variant="cards" :count="4" class="col-span-full" />
    <SharedErrorState
      v-else-if="analytics.error.value"
      class="col-span-full"
      data-testid="project-dashboard-analytics-error"
      :error="analytics.error.value"
      :title="t('projects.dashboard.analyticsError')"
      @retry="analytics.refetch()"
    />
    <div v-else-if="rows.length === 0" class="col-span-full" data-testid="project-dashboard-empty">
      <SharedEmptyState
        bordered
        :title="t(filtered ? 'projects.filteredEmpty' : 'projects.dashboard.empty')"
        :description="t(filtered ? 'projects.filteredEmptyHint' : 'projects.emptyHint')"
      >
        <template v-if="filtered" #action>
          <UButton color="neutral" variant="outline" :disabled="!hydrated" :label="t('projects.filters.clear')" @click="clearFilters" />
        </template>
      </SharedEmptyState>
    </div>
    <template v-else>
      <ProjectDashboardRecentProjects class="col-span-full" :rows="recentRows" :all-rows="rows" />
      <ProjectDashboardCharts :rows="rows" />
    </template>
  </SharedDashboardPage>
</template>
