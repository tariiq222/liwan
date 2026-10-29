<script setup lang="ts">
import { INBOX_TEMPLATE_ANALYTICS_MAX_DAYS } from '@webvue/contracts'
import { formatDate, localIsoDay } from '@webvue/ui/app/utils/formatDate'
import InboxReportFilters from '@/components/inbox/reports/InboxReportFilters.vue'
import InboxReportTabs from '@/components/inbox/reports/InboxReportTabs.vue'
import InboxTemplateAnalyticsTable from '@/components/inbox/reports/InboxTemplateAnalyticsTable.vue'
import { parseInboxReportRoute, reportRange, serializeInboxReportRoute, type InboxReportRoute } from '@/composables/inbox/inboxReportRoute'
import { useInboxChannel } from '@/composables/inbox/useInboxSettings'
import { useInboxCostReport, useInboxReportChannels, useInboxTemplateAnalytics } from '@/composables/inbox/useInboxReports'

// Template analytics of one channel (Meta's counts, up to 90 days). The channel and period live in the address; without a
// channel in the address the first channel is shown.
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const parsed = computed(() => parseInboxReportRoute(route.query, INBOX_TEMPLATE_ANALYTICS_MAX_DAYS))
const channels = useInboxReportChannels(() => localIsoDay(), hydrated)
const channelId = computed(() => parsed.value.channelId ?? channels.data.value?.[0]?.id ?? null)
const filters = computed<InboxReportRoute>(() => ({ ...parsed.value, channelId: channelId.value }))
const range = computed(() => reportRange(filters.value))
function setFilters(next: InboxReportRoute) {
  if (hydrated.value) void router.replace({ path: route.path, query: serializeInboxReportRoute({ ...next, departmentId: null, agentId: null }) })
}

const analytics = useInboxTemplateAnalytics(() => channelId.value ? { channel_id: channelId.value, ...range.value } : null, hydrated)
// The billing currency of the amounts spent comes with the cost report of the same channel.
const cost = useInboxCostReport(() => ({ ...range.value, ...(channelId.value ? { channel_id: channelId.value } : {}) }), () => hydrated.value && !!channelId.value)
// Whether Meta's opt-in is on is a channel health fact, readable by whoever administers the channel.
const channel = useInboxChannel(() => can('inbox.channels.manage') && hydrated.value ? channelId.value : null)
const insightsOff = computed(() => channel.data.value?.health.template_insights_enabled === false)
const detailQuery = computed(() => serializeInboxReportRoute({ ...filters.value, departmentId: null, agentId: null }))
const tags = computed(() => [
  { label: t('inbox.reports.tags.range', { from: formatDate(range.value.from), to: formatDate(range.value.to) }), kind: 'schedule' as const, icon: 'i-lucide-calendar-range' },
])
</script>

<template>
  <SharedDashboardPage :title="t('inbox.reports.title')" :tags="tags" data-testid="inbox-reports-templates-page">
    <template #filters>
      <div class="flex min-w-0 flex-col gap-3">
        <InboxReportTabs />
        <InboxReportFilters
          :route="filters" :channels="channels.data.value" :max-days="INBOX_TEMPLATE_ANALYTICS_MAX_DAYS" :custom="false" channel-required
          :disabled="!hydrated" @update:route="setFilters"
        />
      </div>
    </template>

    <SharedEmptyState v-if="channels.data.value && !channels.data.value.length" bordered class="col-span-full" :title="t('inbox.reports.templates.noChannels')" />
    <template v-else>
      <UAlert
        v-if="insightsOff" class="col-span-full" color="info" variant="subtle" icon="i-lucide-info" :title="t('inbox.reports.templates.insightsOff')"
        :description="t('inbox.reports.templates.insightsOffHint')" data-testid="inbox-template-insights-off"
        :actions="[{ label: t('inbox.reports.templates.enableLink'), to: `/settings/apps/inbox/channels/${channelId}/health`, color: 'neutral', variant: 'outline' }]"
      />
      <InboxTemplateAnalyticsTable
        class="col-span-full" :rows="analytics.data.value?.items ?? []" :currency="cost.data.value?.currency ?? null" :detail-query="detailQuery"
        :loading="!hydrated || !channelId || analytics.isPending.value" :error="analytics.error.value" @retry="analytics.refetch()"
      />
    </template>
  </SharedDashboardPage>
</template>
