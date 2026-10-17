<script setup lang="ts">
import type { ProjectReportRow } from '@webvue/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartData'

// The four headline figures. The one that asks for action (projects late or at risk) is the emphasised tile; every tile
// carries its share of the matching projects, computed from the rows already loaded.
const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t, locale } = useI18n()
const metrics = computed(() => projectDashboardMetrics(props.rows))
// Intl owns the percent sign and its spacing: "16.7%" in both locales, never "16.7 %".
const percent = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }))
const metricValue = (key: string) => metrics.value.find(metric => metric.key === key)?.value ?? null
const share = (count: number) => props.rows.length ? Math.round((count / props.rows.length) * 100) : undefined
const needsAttention = (row: ProjectReportRow) => (row.overdue_task_count ?? 0) > 0 || row.project.status === 'at_risk' || row.project.status === 'off_track'

const tiles = computed(() => {
  const total = props.rows.length
  const attention = props.rows.filter(needsAttention).length
  const done = props.rows.filter(row => row.project.status === 'done').length
  const taskProgress = metricValue('taskProgress')
  const budgeted = metricValue('budgeted') ?? 0
  const withShare = (count: number, hintKey: string) => {
    const value = share(count)
    return value === undefined ? {} : { progress: value, hint: t(hintKey, { percent: value }) }
  }
  return [
    { key: 'projects', icon: 'i-lucide-folder-kanban', tone: 'neutral', value: total, ...withShare(done, 'projects.dashboard.kpi.percentDone') },
    { key: 'attention', icon: 'i-lucide-triangle-alert', tone: attention > 0 ? 'danger' : 'success', emphasis: true, value: attention, ...withShare(attention, 'projects.dashboard.kpi.percentOfTotal') },
    {
      key: 'taskProgress', icon: 'i-lucide-list-checks', tone: 'success',
      value: taskProgress == null ? t('projects.dashboard.unknown') : percent.value.format(taskProgress / 100),
      valueDir: taskProgress == null ? undefined : 'ltr',
      ...(taskProgress == null ? {} : { progress: taskProgress }),
    },
    { key: 'budgeted', icon: 'i-lucide-wallet', tone: 'neutral', value: budgeted, ...withShare(budgeted, 'projects.dashboard.kpi.percentOfTotal') },
  ] as const
})
</script>

<template>
  <SharedMetricTile
    v-for="tile in tiles"
    :key="tile.key"
    density="compact"
    :icon="tile.icon"
    :tone="tile.tone"
    :emphasis="'emphasis' in tile ? tile.emphasis : undefined"
    :label="t(`projects.dashboard.kpi.${tile.key}`)"
    :value="tile.value"
    :hint="'hint' in tile ? tile.hint : undefined"
    :progress="'progress' in tile ? tile.progress : undefined"
    :value-dir="'valueDir' in tile ? tile.valueDir : 'ltr'"
  />
</template>
