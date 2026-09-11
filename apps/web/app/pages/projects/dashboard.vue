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
</script>

<template>
  <SharedPageContainer width="list" data-testid="project-dashboard-page">
    <SharedPageHeader :title="t('projects.dashboard.title')" :description="t('projects.dashboard.description')" />

    <div class="w-full min-w-0">
      <FilterBar inline class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="clearFilters">
        <template #search>
          <UInput v-model="search" :disabled="!hydrated" :placeholder="t('projects.reports.search')" :aria-label="t('projects.reports.search')" icon="i-lucide-search" class="min-w-52 flex-1" />
        </template>
        <USelect
          :model-value="filters.status"
          data-testid="project-dashboard-status-filter"
          class="w-40"
          :disabled="!hydrated"
          :items="[
            { value: 'all', label: t('projects.filters.allStatuses') },
            { value: 'unset', label: t('projects.status.unset') },
            ...PROJECT_STATUSES.map(status => ({ value: status, label: t(`projects.status.${status}`) })),
          ]"
          @update:model-value="onStatusChange"
        />
        <template #active>
          <div v-if="filtered" class="flex flex-wrap items-center gap-2">
            <UBadge v-if="filters.q.trim()" color="secondary" variant="subtle">{{ t('projects.filters.searchValue', { value: filters.q }) }}</UBadge>
            <UBadge v-if="filters.status !== 'all'" color="secondary" variant="subtle">{{ t(filters.status === 'unset' ? 'projects.filters.unset' : `projects.status.${filters.status}`) }}</UBadge>
          </div>
        </template>
      </FilterBar>
    </div>

    <div v-if="!hydrated || (analytics.isLoading.value && !analytics.data.value)" role="status" class="space-y-5" :aria-label="t('app.loading')">
      <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><USkeleton v-for="n in 4" :key="n" class=" h-24 rounded-none" /></div>
      <div class="grid gap-5 xl:grid-cols-2"><USkeleton v-for="n in 6" :key="n" class="h-[350px] rounded-lg bg-default" /></div>
    </div>

    <div v-else-if="analytics.error.value" data-testid="project-dashboard-analytics-error" role="alert" class="rounded-xl border border-default bg-default overflow-hidden">
      <div class="border-b border-default px-5 py-4"><h2 class="text-lg font-semibold text-highlighted">{{ t('projects.dashboard.analyticsError') }}</h2></div>
      <div class="p-5 space-y-3">
        <UButton variant="outline" :disabled="!hydrated" @click="analytics.refetch()">{{ t('projects.dashboard.retryAnalytics') }}</UButton>
      </div>
    </div>

    <div v-else-if="rows.length === 0" data-testid="project-dashboard-empty" role="status" class="rounded-xl border border-default bg-default overflow-hidden text-sm text-muted">
      <div class="border-b border-default px-5 py-4"><h2 class="text-lg font-semibold text-highlighted">{{ t(filtered ? 'projects.filteredEmpty' : 'projects.dashboard.empty') }}</h2></div>
      <div class="p-5 text-center">
        <p>{{ t(filtered ? 'projects.filteredEmptyHint' : 'projects.emptyHint') }}</p>
        <UButton v-if="filtered" variant="outline" class="mt-4" :disabled="!hydrated" @click="clearFilters">{{ t('projects.filters.clear') }}</UButton>
      </div>
    </div>

    <template v-else>
      <ProjectDashboardMetrics :rows="rows" />
      <ProjectDashboardCharts :rows="rows" />
      <ProjectDashboardRecentProjects :rows="recentRows" />
    </template>
  </SharedPageContainer>
</template>
