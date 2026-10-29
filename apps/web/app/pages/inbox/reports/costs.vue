<script setup lang="ts">
import { formatDate, formatDateTime, localIsoDay } from '@webvue/ui/app/utils/formatDate'
import InboxCostCharts from '@/components/inbox/reports/InboxCostCharts.vue'
import InboxCostCountries from '@/components/inbox/reports/InboxCostCountries.vue'
import InboxReportFilters from '@/components/inbox/reports/InboxReportFilters.vue'
import InboxReportTabs from '@/components/inbox/reports/InboxReportTabs.vue'
import { costTiles } from '@/composables/inbox/inboxReportCharts'
import { costQuery, parseInboxReportRoute, reportRange, serializeInboxReportRoute, type InboxReportRoute } from '@/composables/inbox/inboxReportRoute'
import { useInboxCostReport, useInboxReportChannels } from '@/composables/inbox/useInboxReports'

// Meta's cost and volume per day, category and country. The days are UTC days and the amounts approximate (Meta's own figures).
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const filters = computed(() => parseInboxReportRoute(route.query))
const range = computed(() => reportRange(filters.value))
function setFilters(next: InboxReportRoute) {
  if (hydrated.value) void router.replace({ path: route.path, query: serializeInboxReportRoute({ ...next, departmentId: null, agentId: null }) })
}

const report = useInboxCostReport(() => costQuery(filters.value), hydrated)
const channels = useInboxReportChannels(() => localIsoDay(), hydrated)
const data = computed(() => report.data.value)
const tiles = computed(() => data.value ? costTiles(data.value, t, locale.value) : [])
const tags = computed(() => [
  { label: t('inbox.reports.tags.range', { from: formatDate(range.value.from), to: formatDate(range.value.to) }), kind: 'schedule' as const, icon: 'i-lucide-calendar-range' },
  { label: t('inbox.reports.tags.utcDays'), kind: 'schedule' as const, icon: 'i-lucide-globe' },
])
const syncTime = (value: string | null) => value ? t('inbox.reports.costs.sync.at', { time: formatDateTime(value) }) : t('inbox.reports.costs.sync.never')
const costUnknown = computed(() => !!data.value && data.value.totals.cost === null && data.value.totals.volume > 0)
</script>

<template>
  <SharedDashboardPage :title="t('inbox.reports.title')" :tags="tags" kpi-toggle data-testid="inbox-reports-costs-page">
    <template #filters>
      <div class="flex min-w-0 flex-col gap-3">
        <InboxReportTabs />
        <InboxReportFilters :route="filters" :channels="channels.data.value" :disabled="!hydrated" @update:route="setFilters" />
        <p class="text-sm text-muted">{{ t('inbox.reports.costs.hint') }}</p>
      </div>
    </template>

    <SharedErrorState v-if="report.error.value" class="col-span-full" data-testid="inbox-reports-error" :error="report.error.value" :title="t('inbox.reports.error')" @retry="report.refetch()" />
    <template v-else>
      <SharedKpiStrip class="col-span-full" :tiles="tiles" :loading="!hydrated || !data" :skeleton-count="4" :label="t('inbox.reports.costs.kpiLabel')" data-testid="inbox-cost-kpis" />
      <SharedLoadingSkeleton v-if="!data" variant="cards" :count="3" class="col-span-full" />
      <template v-else>
        <UAlert v-if="costUnknown" class="col-span-full" color="info" variant="subtle" icon="i-lucide-info" :title="t('inbox.reports.costs.noCost')" data-testid="inbox-cost-unknown" />
        <InboxCostCharts :report="data" />
        <InboxCostCountries class="col-span-full" :rows="data.by_country" :currency="data.currency" />
        <SharedRecordSection class="col-span-full" variant="list" :title="t('inbox.reports.costs.sync.title')" :description="t('inbox.reports.costs.sync.description')" data-testid="inbox-cost-sync">
          <ul class="divide-y divide-default">
            <li v-for="item in data.channels" :key="item.channel.id" class="flex flex-col gap-1 px-(--webvue-card-pad) py-3">
              <span class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted"><bdi>{{ item.channel.name }}</bdi></span>
                <span class="text-sm text-muted">{{ syncTime(item.synced_at) }}</span>
              </span>
              <span v-if="item.error" class="text-sm text-error">{{ t('inbox.reports.costs.sync.error') }}: <bdi>{{ item.error }}</bdi></span>
            </li>
          </ul>
        </SharedRecordSection>
      </template>
    </template>
  </SharedDashboardPage>
</template>
