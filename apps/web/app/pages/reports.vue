<script setup lang="ts">
import { PROJECT_STATUSES } from '@nasq/contracts'
import { refDebounced } from '@vueuse/core'
import FilterBar from '@/components/shared/FilterBar.vue'
import ReportTable from '@/components/project/finance/ReportTable.vue'
import ReportTotals from '@/components/project/finance/ReportTotals.vue'
import { useProjectReports } from '@/composables/useProjectReports'
import {
  REPORT_PAGE,
  parseReportListRoute,
  parseReportStatus,
  patchReportListRoute,
  nextOffsetAfterListResult,
  sameReportListRoute,
  serializeReportListRoute,
  type ReportListRouteState,
} from '@/utils/projectFinance'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const filters = reactive<ReportListRouteState>(parseReportListRoute(route.query as Record<string, unknown>))
const search = ref(filters.q)
const debouncedSearch = refDebounced(search, 250)
let applyingRoute = false
let writeQuery: Promise<void> = Promise.resolve()

const listFilters = computed(() => ({
  q: filters.q.trim() || undefined,
  status: filters.status,
  limit: REPORT_PAGE,
  offset: filters.offset,
}))
const reports = useProjectReports(listFilters)
const items = computed(() => reports.data.value?.items ?? [])
const totals = computed(() => reports.data.value?.totals ?? [])
const total = computed(() => reports.data.value?.total ?? 0)
const page = computed(() => Math.floor(filters.offset / REPORT_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / REPORT_PAGE)))
const filtered = computed(() => Boolean(filters.q.trim()) || filters.status !== 'all')

function applyPatch(patch: Partial<ReportListRouteState>) {
  Object.assign(filters, patchReportListRoute(filters, patch))
}

function scheduleQueryWrite() {
  writeQuery = writeQuery.then(async () => {
    const query = serializeReportListRoute(filters)
    if (sameReportListRoute(query, serializeReportListRoute(parseReportListRoute(route.query as Record<string, unknown>)))) return
    applyingRoute = true
    try {
      await router.replace({ query })
    }
    finally {
      applyingRoute = false
    }
  }).catch(() => undefined)
}

watch(debouncedSearch, (value) => {
  if (value.trim() === filters.q.trim()) return
  applyPatch({ q: value })
})
watch([() => filters.q, () => filters.status, () => filters.offset], () => {
  scheduleQueryWrite()
})
watch(() => route.query, (query) => {
  if (applyingRoute) return
  const parsed = parseReportListRoute(query as Record<string, unknown>)
  if (sameReportListRoute(serializeReportListRoute(filters), serializeReportListRoute(parsed))) return
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

function setPage(next: number) {
  if (!hydrated.value || reports.isFetching.value || next < 1 || next > pages.value) return
  applyPatch({ offset: (next - 1) * REPORT_PAGE })
}

watch(
  () => ({
    fetching: reports.isFetching.value,
    offset: filters.offset,
    queryOffset: listFilters.value.offset,
    total: reports.data.value?.total,
  }),
  ({ fetching, offset, queryOffset, total }) => {
    const next = nextOffsetAfterListResult({
      isFetching: fetching,
      requestedOffset: offset,
      responseOffset: queryOffset,
      total,
      pageSize: REPORT_PAGE,
    })
    if (next === null) return
    applyPatch({ offset: next })
  },
)
</script>

<template>
  <SharedPageContainer width="list" data-testid="reports-page">
    <SharedPageHeader :title="t('projects.reports.title')" :description="t('projects.reports.description')" />
    <div class="nasq-toolbar">
      <FilterBar class="w-full">
        <template #search>
          <Input v-model="search" :disabled="!hydrated" :placeholder="t('projects.reports.search')" :aria-label="t('projects.reports.search')" class="min-w-52" />
        </template>
        <Select :model-value="filters.status" @update:model-value="onStatusChange">
          <SelectTrigger data-testid="reports-status-filter" class="w-40" :disabled="!hydrated">
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
    <SharedPageState :loading="reports.isLoading.value && !reports.data.value" :error="reports.error.value" @retry="reports.refetch">
      <ReportTotals :totals="totals" />
      <ReportTable :items="items" :is-loading="reports.isLoading.value" :filtered="filtered" />
      <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
        <Button variant="ghost" :disabled="!hydrated || page === 1 || reports.isFetching.value" @click="setPage(page - 1)">{{ t('projects.previousPage') }}</Button>
        <span>{{ t('projects.pageOf', { page, pages }) }}</span>
        <Button variant="ghost" :disabled="!hydrated || page >= pages || reports.isFetching.value" @click="setPage(page + 1)">{{ t('projects.nextPage') }}</Button>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
