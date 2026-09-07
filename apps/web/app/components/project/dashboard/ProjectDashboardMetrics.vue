<script setup lang="ts">
import type { ProjectReportRow } from '@nasq/contracts'
import { projectDashboardMetrics } from '@/utils/projectChartOptions'

const props = defineProps<{ rows: readonly ProjectReportRow[] }>()
const { t } = useI18n()
const unknown = computed(() => t('projects.dashboard.unknown'))
const metrics = computed(() => projectDashboardMetrics(props.rows))
</script>

<template>
  <section :aria-label="t('projects.dashboard.metrics.metricsLabel')" class="nasq-panel overflow-hidden">
    <div class="grid grid-cols-2 divide-x divide-y divide-border rtl:divide-x-reverse sm:grid-cols-4 sm:divide-y-0">
      <article v-for="metric in metrics" :key="metric.key" class="min-w-0 p-4 first:sm:border-s-0">
        <p class="truncate text-sm text-muted-foreground">{{ t(`projects.dashboard.metrics.${metric.key}`) }}</p>
        <p class="mt-2 text-2xl font-semibold tabular-nums" :dir="metric.suffix ? 'ltr' : undefined">
          {{ metric.value == null ? unknown : metric.value }}<span v-if="metric.value != null && metric.suffix" class="ms-1 text-lg">{{ metric.suffix }}</span>
        </p>
      </article>
    </div>
  </section>
</template>
