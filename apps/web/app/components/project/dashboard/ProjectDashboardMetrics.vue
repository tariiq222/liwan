<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import { Activity, BarChart3, FolderKanban, ListChecks, Wallet } from '@lucide/vue'
import type { Component } from 'vue'
import { projectDashboardMetrics } from '@/utils/projectChartData'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
// One icon per metric so the tiles read at a glance; colours come from the brand tokens.
const METRIC_ICON: Record<string, Component> = {
  projects: FolderKanban,
  active: Activity,
  taskProgress: ListChecks,
  budgeted: Wallet,
}
</script>

<template>
  <section :aria-label="t('projects.dashboard.metrics.metricsLabel')" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <UCard v-for="metric in metrics" :key="metric.key" :ui="{ body: 'flex items-center gap-4 p-5' }">
      <span class="nasq-ui-metric-icon" aria-hidden="true">
        <component :is="METRIC_ICON[metric.key] ?? BarChart3" class="size-5" />
      </span>
      <div class="min-w-0">
        <p class="truncate text-sm text-muted">{{ t(`projects.dashboard.metrics.${metric.key}`) }}</p>
        <p class="mt-0.5 text-2xl font-semibold tracking-tight text-highlighted tabular-nums" :dir="metric.suffix ? 'ltr' : undefined">
          {{ metric.value == null ? unknown : metric.value }}<span v-if="metric.value != null && metric.suffix" class="ms-1 text-xs font-normal tracking-normal text-muted">{{ metric.suffix }}</span>
        </p>
      </div>
    </UCard>
  </section>
</template>
