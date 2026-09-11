<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartData'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
</script>

<template>
  <section :aria-label="t('projects.dashboard.metrics.metricsLabel')" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <UCard v-for="metric in metrics" :key="metric.key">
      <p class="truncate text-sm text-muted">{{ t(`projects.dashboard.metrics.${metric.key}`) }}</p>
      <p class="mt-1.5 text-2xl font-medium tracking-tight text-highlighted tabular-nums" :dir="metric.suffix ? 'ltr' : undefined">
        {{ metric.value == null ? unknown : metric.value }}<span v-if="metric.value != null && metric.suffix" class="ms-1 text-xs font-normal tracking-normal text-muted">{{ metric.suffix }}</span>
      </p>
    </UCard>
  </section>
</template>
