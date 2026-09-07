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

    <div class="nasq-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <Input v-model="search" :disabled="!hydrated" :placeholder="t('projects.reports.search')" :aria-label="t('projects.reports.search')" class="min-w-52" />
        </template>
        <Select :model-value="filters.status" @update:model-value="onStatusChange">
          <SelectTrigger data-testid="project-dashboard-status-filter" class="w-40" :disabled="!hydrated">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{{ t('projects.filters.allStatuses') }}</SelectItem>
            <SelectItem value="unset">{{ t('projects.status.unset') }}</SelectItem>
            <SelectItem v-for="status in PROJECT_STATUSES" :key="status" :value="status">{{ t(`projects.status.${status}`) }}</SelectItem>
          </SelectContent>
        </Select>
        <Button v-if="filtered" variant="ghost" size="sm" :disabled="!hydrated" @click="clearFilters">{{ t('projects.filters.clear') }}</Button>
      </FilterBar>
    </div>

    <div v-if="!hydrated || (analytics.isLoading.value && !analytics.data.value)" role="status" class="space-y-5" :aria-label="t('app.loading')">
      <div class="nasq-metrics"><Skeleton v-for="n in 4" :key="n" class="nasq-metric h-24 rounded-none" /></div>
      <div class="grid gap-5 xl:grid-cols-2"><Skeleton v-for="n in 6" :key="n" class="h-[350px] rounded-lg bg-card" /></div>
    </div>

    <div v-else-if="analytics.error.value" data-testid="project-dashboard-analytics-error" role="alert" class="nasq-panel space-y-3 p-6">
      <p class="font-medium">{{ t('projects.dashboard.analyticsError') }}</p>
      <Button variant="outline" :disabled="!hydrated" @click="analytics.refetch">{{ t('projects.dashboard.retryAnalytics') }}</Button>
    </div>

    <div v-else-if="rows.length === 0" data-testid="project-dashboard-empty" role="status" class="nasq-panel p-10 text-center text-sm text-muted-foreground">
      <p class="font-medium text-foreground">{{ t(filtered ? 'projects.filteredEmpty' : 'projects.dashboard.empty') }}</p>
      <p class="mt-1">{{ t(filtered ? 'projects.filteredEmptyHint' : 'projects.emptyHint') }}</p>
      <Button v-if="filtered" variant="outline" class="mt-4" :disabled="!hydrated" @click="clearFilters">{{ t('projects.filters.clear') }}</Button>
    </div>

    <template v-else>
      <ProjectDashboardMetrics :rows="rows" />
      <ProjectDashboardCharts :rows="rows" />
      <ProjectDashboardRecentProjects :rows="recentRows" />
    </template>
  </SharedPageContainer>
</template>
