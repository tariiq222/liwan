<script setup lang="ts">
import { formatDate, formatDateTime, localIsoDay } from '@liwan/ui/app/utils/formatDate'
import InboxAgentTable from '@/components/inbox/reports/InboxAgentTable.vue'
import InboxReportCharts from '@/components/inbox/reports/InboxReportCharts.vue'
import InboxReportFilters from '@/components/inbox/reports/InboxReportFilters.vue'
import InboxReportTabs from '@/components/inbox/reports/InboxReportTabs.vue'
import { overviewTiles } from '@/composables/inbox/inboxReportCharts'
import { breakdownQuery, overviewQuery, parseInboxReportRoute, reportRange, serializeInboxReportRoute, type InboxReportRoute } from '@/composables/inbox/inboxReportRoute'
import { REPORTS_PATH } from '@/composables/inbox/inboxReportNav'
import { useInboxAgents } from '@/composables/inbox/useInbox'
import { useInboxReportBreakdown, useInboxReportChannels, useInboxReportExport, useInboxReportOverview } from '@/composables/inbox/useInboxReports'
import { useInboxDepartments } from '@/composables/inbox/useInboxSettings'

// The inbox overview report: KPI strip with the change against the previous period, five charts and the agent table. The
// filters (period, channel, department, agent) live in the address, so a direct link, a refresh and Back keep them.
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const filters = computed(() => parseInboxReportRoute(route.query))
const range = computed(() => reportRange(filters.value))
function setFilters(next: InboxReportRoute) {
  if (hydrated.value) void router.replace({ path: route.path, query: serializeInboxReportRoute(next) })
}

const overview = useInboxReportOverview(() => overviewQuery(filters.value), hydrated)
const departmentRows = useInboxReportBreakdown('department', () => breakdownQuery(filters.value), hydrated)
const agentRows = useInboxReportBreakdown('agent', () => breakdownQuery(filters.value), hydrated)
const channels = useInboxReportChannels(() => localIsoDay(), hydrated)
const departments = useInboxDepartments(hydrated)
const agents = useInboxAgents(hydrated)

const data = computed(() => overview.data.value)
const tiles = computed(() => data.value ? overviewTiles(data.value.totals, data.value.previous, t, locale.value, `${REPORTS_PATH}/templates`) : [])
const tags = computed(() => [
  { label: t('inbox.reports.tags.range', { from: formatDate(range.value.from), to: formatDate(range.value.to) }), kind: 'schedule' as const, icon: 'i-lucide-calendar-range' },
  ...(data.value ? [{ label: t('inbox.reports.tags.timezone', { zone: data.value.timezone }), kind: 'schedule' as const, icon: 'i-lucide-globe' }] : []),
  ...(data.value?.computed_at ? [{ label: t('inbox.reports.tags.computedAt', { time: formatDateTime(data.value.computed_at) }), kind: 'category' as const }] : []),
])

const exportReport = useInboxReportExport()
const exporting = ref(false)
async function exportCsv() {
  exporting.value = true
  try {
    await exportReport('agent', breakdownQuery(filters.value))
    toast.add({ title: t('inbox.reports.agents.exported'), color: 'success' })
  } catch (e) {
    toast.add({ title: e instanceof Error ? e.message : t('inbox.reports.agents.exportFailed'), color: 'error' })
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <SharedDashboardPage :title="t('inbox.reports.title')" :tags="tags" kpi-toggle data-testid="inbox-reports-page">
    <template #filters>
      <div class="flex min-w-0 flex-col gap-3">
        <InboxReportTabs />
        <InboxReportFilters
          :route="filters" :channels="channels.data.value" :departments="departments.data.value?.items" :agents="agents.data.value?.items"
          :disabled="!hydrated" @update:route="setFilters"
        />
      </div>
    </template>

    <SharedErrorState v-if="overview.error.value" class="col-span-full" data-testid="inbox-reports-error" :error="overview.error.value" :title="t('inbox.reports.error')" @retry="overview.refetch()" />
    <template v-else>
      <SharedKpiStrip class="col-span-full" :tiles="tiles" :loading="!hydrated || !data" :skeleton-count="8" :label="t('inbox.reports.kpiLabel')" data-testid="inbox-reports-kpis" />
      <SharedLoadingSkeleton v-if="!data" variant="cards" :count="4" class="col-span-full" />
      <InboxReportCharts v-else :overview="data" :departments="departmentRows.data.value?.items ?? []" />
      <InboxAgentTable
        class="col-span-full" :rows="agentRows.data.value?.items ?? []" :loading="!hydrated || agentRows.isPending.value" :error="agentRows.error.value"
        :exporting="exporting" @export="exportCsv" @retry="agentRows.refetch()"
      />
    </template>
  </SharedDashboardPage>
</template>
