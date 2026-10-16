<script setup lang="ts">
import type { ProjectReportRow } from '@webvue/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartData'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t, locale } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
// Intl owns the percent sign and its spacing: "16.7%" in both locales, never "16.7 %".
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }))
const display = (metric: { value: number | null; suffix?: '%' }) => metric.value == null ? unknown.value : metric.suffix ? percent.value.format(metric.value / 100) : metric.value
// One icon per metric so the tiles read at a glance; colours come from the brand tokens.
const METRIC_ICON: Record<string, `i-lucide-${string}`> = {
  projects: 'i-lucide-folder-kanban',
  active: 'i-lucide-activity',
  taskProgress: 'i-lucide-list-checks',
  budgeted: 'i-lucide-wallet',
}
</script>

<template>
  <SharedMetricTile
    v-for="metric in metrics"
    :key="metric.key"
    :icon="METRIC_ICON[metric.key] ?? 'i-lucide-chart-column'"
    :label="t(`projects.dashboard.kpi.${metric.key}`)"
    :value="display(metric)"
    :value-dir="metric.suffix && metric.value != null ? 'ltr' : undefined"
  />
</template>
