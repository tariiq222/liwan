<script setup lang="ts">
import type { DashboardChart as DashboardChartModel } from '@/utils/projectChartData'
import ChartPanel from '@/components/shared/ChartPanel.vue'
import DashboardChart from '@/components/shared/DashboardChart.client.vue'

// One project chart: the shared panel (title, loading, the chart's own empty sentence) around the Unovis chart.
withDefaults(defineProps<{
  testId: string
  title: string
  description: string
  chart: DashboardChartModel
  variant?: 'pie' | 'donut' | 'donut-text'
  hasData: boolean
  loading?: boolean
  emptyText: string
  accessibleLabel: string
  height?: string
}>(), {
  loading: false,
  height: '300px',
})
</script>

<template>
  <ChartPanel :data-testid="testId" :title="title" :description="description" :loading="loading" :empty="!hasData" :empty-text="emptyText">
    <DashboardChart :chart="chart" :variant="variant" :accessible-label="accessibleLabel" :height="height" />
  </ChartPanel>
</template>
