<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { InboxTemplateButtonClicks } from '@webvue/contracts'
import { INBOX_TEMPLATE_ANALYTICS_MAX_DAYS } from '@webvue/contracts'
import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import InboxChartPanel from '@/components/inbox/reports/InboxChartPanel.vue'
import InboxReportFilters from '@/components/inbox/reports/InboxReportFilters.vue'
import { formatAmount, formatRatio, hasTemplateSeries, shareOf, templateSeriesChart } from '@/composables/inbox/inboxReportCharts'
import { REPORTS_PATH } from '@/composables/inbox/inboxReportNav'
import { parseInboxReportRoute, reportRange, serializeInboxReportRoute, type InboxReportRoute } from '@/composables/inbox/inboxReportRoute'
import { TEMPLATE_CATEGORY_TONE } from '@/composables/inbox/inboxTemplate'
import { useInboxCostReport, useInboxTemplateAnalyticsDetail } from '@/composables/inbox/useInboxReports'
import { statusTag } from '@webvue/ui/app/utils/pageHeaderTag'

// One template's analytics: the funnel (sent, delivered, read, clicked), the days, and the clicks of each button.
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()

const templateId = computed(() => {
  const value = Number(route.params.templateId)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const filters = computed(() => parseInboxReportRoute(route.query, INBOX_TEMPLATE_ANALYTICS_MAX_DAYS))
const range = computed(() => reportRange(filters.value))
const backQuery = computed(() => serializeInboxReportRoute({ ...filters.value, departmentId: null, agentId: null }))
const backTo = computed(() => ({ path: `${REPORTS_PATH}/templates`, query: backQuery.value }))
function setFilters(next: InboxReportRoute) {
  if (hydrated.value) void router.replace({ path: route.path, query: serializeInboxReportRoute({ ...next, departmentId: null, agentId: null }) })
}

const query = useInboxTemplateAnalyticsDetail(templateId, range, hydrated)
const cost = useInboxCostReport(() => ({ ...range.value, ...(filters.value.channelId ? { channel_id: filters.value.channelId } : {}) }), () => hydrated.value && !!filters.value.channelId)
const data = computed(() => query.data.value)
const currency = computed(() => cost.data.value?.currency ?? null)
const count = computed(() => new Intl.NumberFormat(locale.value))
const tags = computed(() => data.value ? [
  statusTag({ tone: TEMPLATE_CATEGORY_TONE[data.value.template.category], label: t(`inbox.templates.category.${data.value.template.category}`) }),
  { label: data.value.template.language, kind: 'category' as const },
  { label: t('inbox.reports.tags.range', { from: formatDate(range.value.from), to: formatDate(range.value.to) }), kind: 'schedule' as const, icon: 'i-lucide-calendar-range' },
] : [])

const funnel = computed<KpiTile[]>(() => {
  const totals = data.value?.totals
  if (!totals) return []
  const stage = (id: string, icon: KpiTile['icon'], label: string, value: number, ofSent: boolean): KpiTile => {
    const share = shareOf(value, totals.sent)
    return {
      id, icon, label, value: count.value.format(value),
      ...(ofSent && share !== null ? { progress: Math.round(share * 100), hint: `${formatRatio(share, locale.value)} ${t('inbox.reports.templates.detail.ofSent')}` } : {}),
    }
  }
  return [
    stage('sent', 'i-lucide-send', t('inbox.reports.templates.detail.sent'), totals.sent, false),
    stage('delivered', 'i-lucide-check-check', t('inbox.reports.templates.detail.delivered'), totals.delivered, true),
    stage('read', 'i-lucide-eye', t('inbox.reports.templates.detail.read'), totals.read, true),
    stage('clicked', 'i-lucide-mouse-pointer-click', t('inbox.reports.templates.detail.clicked'), totals.clicked, true),
  ]
})
const extras = computed<KpiTile[]>(() => {
  const totals = data.value?.totals
  if (!totals) return []
  return [
    { id: 'spent', icon: 'i-lucide-wallet', label: t('inbox.reports.templates.detail.totals.spent'), value: formatAmount(totals.amount_spent, currency.value, locale.value) },
    { id: 'webvue-sent', icon: 'i-lucide-send', label: t('inbox.reports.templates.detail.totals.webvueSent'), value: count.value.format(totals.webvue_sent) },
    { id: 'webvue-failed', icon: 'i-lucide-triangle-alert', label: t('inbox.reports.templates.detail.totals.webvueFailed'), value: count.value.format(totals.webvue_failed), ...(totals.webvue_failed > 0 ? { tone: 'danger' as const } : {}) },
  ]
})
const chart = computed(() => templateSeriesChart(data.value?.series ?? [], {
  sent: t('inbox.reports.templates.detail.sent'), delivered: t('inbox.reports.templates.detail.delivered'), read: t('inbox.reports.templates.detail.read'), clicked: t('inbox.reports.templates.detail.clicked'),
}))
const columns = computed<TableColumn<InboxTemplateButtonClicks>[]>(() => [
  { id: 'text', header: t('inbox.reports.templates.detail.buttons.text'), meta: { class: { th: 'text-start', td: 'max-w-0' } } as TableColumn<InboxTemplateButtonClicks>['meta'] },
  { id: 'type', header: t('inbox.reports.templates.detail.buttons.type'), meta: { class: { th: 'text-start w-40', td: 'whitespace-nowrap' } } as TableColumn<InboxTemplateButtonClicks>['meta'] },
  { id: 'clicked', header: t('inbox.reports.templates.detail.buttons.clicked'), meta: { class: { th: 'text-start w-32', td: 'whitespace-nowrap tabular-nums' } } as TableColumn<InboxTemplateButtonClicks>['meta'] },
])
</script>

<template>
  <SharedRecordPage
    :title="data?.template.name ?? t('inbox.reports.templates.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.reports.templates.detail.back')"
    :loading="templateId !== null && (!hydrated || query.isPending.value)"
    :error="templateId === null ? { status: 404 } : query.error.value"
    data-testid="inbox-template-analytics-detail"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="data">
      <InboxReportFilters :route="filters" :max-days="INBOX_TEMPLATE_ANALYTICS_MAX_DAYS" :custom="false" :disabled="!hydrated" @update:route="setFilters" />
      <SharedKpiStrip :tiles="funnel" :label="t('inbox.reports.templates.detail.funnelLabel')" data-testid="inbox-template-funnel" />
      <SharedKpiStrip :tiles="extras" :label="t('inbox.reports.templates.detail.funnel')" />
      <InboxChartPanel
        test-id="inbox-chart-template-daily" span="full" size="lg" :chart="chart" :has-data="hasTemplateSeries(data.series)"
        :title="t('inbox.reports.templates.detail.daily.title')" :description="t('inbox.reports.templates.detail.daily.description')" :empty-text="t('inbox.reports.templates.detail.daily.empty')"
      />
      <SharedRecordSection variant="list" :title="t('inbox.reports.templates.detail.buttons.title')" data-testid="inbox-template-buttons">
        <SharedEmptyState v-if="!data.buttons.length" bordered class="m-4" :title="t('inbox.reports.templates.detail.buttons.empty')" />
        <SharedDataTable v-else bare :rows="[...data.buttons]" :columns="columns" :row-key="(row: InboxTemplateButtonClicks) => `${row.type}:${row.text}`" :caption="t('inbox.reports.templates.detail.buttons.caption')">
          <template #text-cell="{ row }"><bdi class="text-sm font-medium text-highlighted">{{ row.original.text }}</bdi></template>
          <template #type-cell="{ row }">{{ t(`inbox.reports.templates.detail.buttons.${row.original.type}`) }}</template>
          <template #clicked-cell="{ row }">{{ count.format(row.original.clicked) }}</template>
        </SharedDataTable>
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
