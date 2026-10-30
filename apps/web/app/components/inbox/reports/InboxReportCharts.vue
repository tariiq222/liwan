<script setup lang="ts">
import type { InboxReportBreakdownRow, InboxReportOverview } from '@liwan/contracts'
import InboxChartPanel from './InboxChartPanel.vue'
import {
  answeredChart, csatChart, firstResponseChart, hasAnswered, hasCsat, hasFirstResponses, hasResolved, hasVolume, resolvedByChart, volumeChart,
} from '@/composables/inbox/inboxReportCharts'

// The five charts of the overview: volume over time, the first-response distribution, satisfaction, who answered, and the
// conversations resolved per department. They render straight into SharedDashboardPage's grid.
const props = defineProps<{ overview: InboxReportOverview; departments: readonly InboxReportBreakdownRow[] }>()
const { t, locale } = useI18n()

const volume = computed(() => volumeChart(props.overview.series, props.overview.granularity, {
  messagesIn: t('inbox.reports.charts.volume.in'), messagesOut: t('inbox.reports.charts.volume.out'), automated: t('inbox.reports.charts.volume.automated'),
}))
const firstResponse = computed(() => firstResponseChart(props.overview.totals.first_response.buckets, bucket => t(`inbox.reports.charts.firstResponse.buckets.${bucket}`), t('inbox.reports.charts.firstResponse.series')))
const csat = computed(() => csatChart(props.overview.totals.csat, {
  good: t('inbox.reports.charts.csat.good'), neutral: t('inbox.reports.charts.csat.neutral'), bad: t('inbox.reports.charts.csat.bad'), centerSub: t('inbox.reports.charts.csat.centerSub'),
}, locale.value))
const answered = computed(() => answeredChart(props.overview.totals, {
  agents: t('inbox.reports.charts.answered.agents'), automated: t('inbox.reports.charts.answered.automated'), centerSub: t('inbox.reports.charts.answered.centerSub'),
}, locale.value))
const resolvedBy = computed(() => resolvedByChart(props.departments, t('inbox.reports.charts.resolvedBy.series'), t('inbox.reports.agents.unassigned')))
</script>

<template>
  <InboxChartPanel
    test-id="inbox-chart-volume" span="full" size="lg"
    :title="t('inbox.reports.charts.volume.title')" :description="t('inbox.reports.charts.volume.description')" :empty-text="t('inbox.reports.charts.volume.empty')"
    :chart="volume" :has-data="hasVolume(overview.series)"
  />
  <InboxChartPanel
    test-id="inbox-chart-first-response"
    :title="t('inbox.reports.charts.firstResponse.title')" :description="t('inbox.reports.charts.firstResponse.description')" :empty-text="t('inbox.reports.charts.firstResponse.empty')"
    :chart="firstResponse" :has-data="hasFirstResponses(overview.totals.first_response.buckets)"
  />
  <InboxChartPanel
    test-id="inbox-chart-csat" variant="donut-text"
    :title="t('inbox.reports.charts.csat.title')" :description="t('inbox.reports.charts.csat.description')" :empty-text="t('inbox.reports.charts.csat.empty')"
    :chart="csat" :has-data="hasCsat(overview.totals.csat)"
  />
  <InboxChartPanel
    test-id="inbox-chart-answered" variant="donut-text"
    :title="t('inbox.reports.charts.answered.title')" :description="t('inbox.reports.charts.answered.description')" :empty-text="t('inbox.reports.charts.answered.empty')"
    :chart="answered" :has-data="hasAnswered(overview.totals)"
  />
  <InboxChartPanel
    test-id="inbox-chart-resolved-by"
    :title="t('inbox.reports.charts.resolvedBy.title')" :description="t('inbox.reports.charts.resolvedBy.description')" :empty-text="t('inbox.reports.charts.resolvedBy.empty')"
    :chart="resolvedBy" :has-data="hasResolved(departments)"
  />
</template>
