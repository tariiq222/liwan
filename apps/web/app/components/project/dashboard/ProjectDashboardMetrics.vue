<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartData'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
// One icon per metric so the tiles read at a glance; colours come from the brand tokens.
const METRIC_ICON: Record<string, `i-lucide-${string}`> = {
  projects: 'i-lucide-folder-kanban',
  active: 'i-lucide-activity',
  taskProgress: 'i-lucide-list-checks',
  budgeted: 'i-lucide-wallet',
}
</script>

<template>
  <section :aria-label="t('projects.dashboard.metrics.metricsLabel')" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <SharedMetricTile
      v-for="metric in metrics"
      :key="metric.key"
      :icon="METRIC_ICON[metric.key] ?? 'i-lucide-chart-column'"
      :label="t(`projects.dashboard.metrics.${metric.key}`)"
      :value="metric.value == null ? unknown : metric.value"
      :unit="metric.value != null ? metric.suffix || undefined : undefined"
      :value-dir="metric.suffix ? 'ltr' : undefined"
    />
  </section>
</template>
