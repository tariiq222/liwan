<script setup lang="ts">
import type { DashboardChart as DashboardChartModel } from '@/utils/projectChartData'
import ChartPanel from '@webvue/ui/app/components/shared/data/ChartPanel.vue'
import DashboardChart from '@/components/shared/data/DashboardChart.client.vue'

// One project chart: the shared panel (title, loading, the chart's own empty sentence) around the Unovis chart.
// `span` and `size` go to the panel, which hands the chart the height of its size.
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
  span?: 'half' | 'full'
  size?: 'sm' | 'md' | 'lg'
}>(), {
  loading: false,
})
</script>

<template>
  <ChartPanel :data-testid="testId" :title="title" :description="description" :loading="loading" :empty="!hasData" :empty-text="emptyText" :span="span" :size="size">
    <template #default="{ height }">
      <DashboardChart :chart="chart" :variant="variant" :accessible-label="accessibleLabel" :height="height" />
    </template>
  </ChartPanel>
</template>
