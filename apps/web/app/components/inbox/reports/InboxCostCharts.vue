<script setup lang="ts">
import type { InboxCostReport } from '@webvue/contracts'
import InboxChartPanel from './InboxChartPanel.vue'
import {
  costByCategoryChart, dailyCostChart, hasCostCategories, hasCostSeries, hasVolumeByType, volumeByTypeChart,
} from '@/composables/inbox/inboxReportCharts'

// The three charts of the cost page: daily cost, cost by pricing category and volume by pricing type (Meta's figures).
const props = defineProps<{ report: InboxCostReport }>()
const { t, locale } = useI18n()

const daily = computed(() => dailyCostChart(props.report.series, t('inbox.reports.costs.charts.daily.series')))
const category = computed(() => costByCategoryChart(
  props.report.by_category, value => t(`inbox.reports.costs.category.${value}`), t('inbox.reports.costs.charts.category.centerSub'), props.report.currency, locale.value,
))
const type = computed(() => volumeByTypeChart(props.report.by_category, value => t(`inbox.reports.costs.type.${value}`), t('inbox.reports.costs.charts.type.series')))
</script>

<template>
  <InboxChartPanel
    test-id="inbox-chart-cost-daily" span="full" size="lg"
    :title="t('inbox.reports.costs.charts.daily.title')" :description="t('inbox.reports.costs.charts.daily.description')" :empty-text="t('inbox.reports.costs.charts.daily.empty')"
    :chart="daily" :has-data="hasCostSeries(report.series)"
  />
  <InboxChartPanel
    test-id="inbox-chart-cost-category" variant="donut-text"
    :title="t('inbox.reports.costs.charts.category.title')" :description="t('inbox.reports.costs.charts.category.description')" :empty-text="t('inbox.reports.costs.charts.category.empty')"
    :chart="category" :has-data="hasCostCategories(report.by_category)"
  />
  <InboxChartPanel
    test-id="inbox-chart-cost-type"
    :title="t('inbox.reports.costs.charts.type.title')" :description="t('inbox.reports.costs.charts.type.description')" :empty-text="t('inbox.reports.costs.charts.type.empty')"
    :chart="type" :has-data="hasVolumeByType(report.by_category)"
  />
</template>
