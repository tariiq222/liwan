<script setup lang="ts">
import { PROJECT_STATUSES } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import ProjectDashboardCharts from '@/components/project/dashboard/ProjectDashboardCharts.vue'
import ProjectDashboardMetrics from '@/components/project/dashboard/ProjectDashboardMetrics.vue'
import ProjectDashboardRecentProjects from '@/components/project/dashboard/ProjectDashboardRecentProjects.vue'
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

const analyticsFilters = computed(() => ({
  q: filters.q.trim() || undefined,
  status: filters.status,
}))
const analytics = useProjectDashboardAnalytics(analyticsFilters)
const rows = computed(() => analytics.data.value?.projects ?? [])
const recentRows = computed(() => analytics.data.value?.recent_projects ?? [])
const filtered = computed(() => Boolean(filters.q.trim()) || filters.status !== 'all')
const activeFilterCount = computed(() => Number(Boolean(filters.q.trim())) + Number(filters.status !== 'all'))

function applyPatch(patch: Partial<DashboardRouteState>) {
  Object.assign(filters, {
    q: patch.q ?? filters.q,
    status: parseReportStatus(patch.status ?? filters.status),
  })
}

function scheduleQueryWrite() {
  writeQuery = writeQuery.then(async () => {
    const query = serializeRoute(filters)
    const current = serializeRoute(parseRoute(route.query as Record<string, unknown>))
    if (sameRoute(query, current)) return
    applyingRoute = true
    try {
      await router.replace({ query })
    } finally {
      applyingRoute = false
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
  <SharedPageContainer width="list" data-testid="project-dashboard-page">
    <SharedPageHeader :title="t('projects.dashboard.title')" />

    <div class="w-full min-w-0">
      <FilterBar class="w-full" :title="t('filterCard.title')" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
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
    </div>

    <template v-if="!hydrated || (analytics.isLoading.value && !analytics.data.value)">
      <div role="status" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" :aria-label="t('app.loading')">
        <USkeleton v-for="n in 4" :key="n" class="h-24 rounded-xl" />
      </div>
      <div class="grid gap-5 xl:grid-cols-2" aria-hidden="true">
        <USkeleton v-for="n in 6" :key="n" class="h-[350px] rounded-xl" />
      </div>
      <USkeleton class="h-64 rounded-xl" aria-hidden="true" />
    </template>

    <UAlert
      v-else-if="analytics.error.value"
      data-testid="project-dashboard-analytics-error"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="t('projects.dashboard.analyticsError')"
    >
      <template #actions>
        <UButton color="secondary" variant="outline" :disabled="!hydrated" :label="t('projects.dashboard.retryAnalytics')" @click="analytics.refetch()" />
      </template>
    </UAlert>

    <div v-else-if="rows.length === 0" data-testid="project-dashboard-empty">
      <SharedEmptyState
        :title="t(filtered ? 'projects.filteredEmpty' : 'projects.dashboard.empty')"
        :description="t(filtered ? 'projects.filteredEmptyHint' : 'projects.emptyHint')"
      >
        <template v-if="filtered" #action>
          <UButton variant="outline" :disabled="!hydrated" :label="t('projects.filters.clear')" @click="clearFilters" />
        </template>
      </SharedEmptyState>
    </div>

    <template v-else>
      <ProjectDashboardMetrics :rows="rows" />
      <ProjectDashboardCharts :rows="rows" />
      <ProjectDashboardRecentProjects :rows="recentRows" />
    </template>
  </SharedPageContainer>
</template>
