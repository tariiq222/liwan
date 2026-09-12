<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartData'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
// One icon per metric so the tiles read at a glance; colours come from the brand tokens.
const METRIC_ICON: Record<string, string> = {
  projects: 'i-lucide-folder-kanban',
  active: 'i-lucide-activity',
  taskProgress: 'i-lucide-list-checks',
  budgeted: 'i-lucide-wallet',
}
</script>

<template>
  <section :aria-label="t('projects.dashboard.metrics.metricsLabel')" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <UCard v-for="metric in metrics" :key="metric.key" :ui="{ body: 'flex items-center gap-4 p-5' }">
      <span class="nasq-ui-metric-icon" aria-hidden="true">
        <UIcon :name="METRIC_ICON[metric.key] ?? 'i-lucide-bar-chart-3'" class="size-5" />
      </span>
      <div class="min-w-0">
        <p class="break-words text-sm leading-5 text-muted">{{ t(`projects.dashboard.metrics.${metric.key}`) }}</p>
        <p class="mt-0.5 text-2xl font-semibold tracking-tight text-highlighted tabular-nums" :dir="metric.suffix ? 'ltr' : undefined">
          {{ metric.value == null ? unknown : metric.value }}<span v-if="metric.value != null && metric.suffix" class="ms-1 text-xs font-normal tracking-normal text-muted">{{ metric.suffix }}</span>
        </p>
      </div>
    </UCard>
  </section>
</template>
