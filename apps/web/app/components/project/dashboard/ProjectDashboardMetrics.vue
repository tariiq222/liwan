<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartOptions'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
</script>

<template>
  <section :aria-label="t('projects.dashboard.metrics.metricsLabel')" class="nasq-metrics">
    <article v-for="metric in metrics" :key="metric.key" class="nasq-metric">
      <p class="nasq-metric-title truncate">{{ t(`projects.dashboard.metrics.${metric.key}`) }}</p>
      <p class="nasq-metric-value tabular-nums" :dir="metric.suffix ? 'ltr' : undefined">
        {{ metric.value == null ? unknown : metric.value }}<span v-if="metric.value != null && metric.suffix" class="ms-1 text-[0.75em] font-normal tracking-normal text-muted-foreground">{{ metric.suffix }}</span>
      </p>
    </article>
  </section>
</template>
