<script setup lang="ts">
import DashboardChart from '@/components/shared/data/DashboardChart.client.vue'

type ChartModel = InstanceType<typeof DashboardChart>['$props']['chart']

// One report chart: the shared panel (title, loading, empty sentence) around the existing donut or bar chart. `span` and `size`
// go to the panel, which hands the chart the height of its size.
withDefaults(defineProps<{
  testId: string
  title: string
  description: string
  chart: ChartModel
  hasData: boolean
  emptyText: string
  loading?: boolean
  variant?: 'pie' | 'donut' | 'donut-text'
  span?: 'half' | 'full'
  size?: 'sm' | 'md' | 'lg'
}>(), { loading: false, variant: undefined, span: undefined, size: undefined })
</script>

<template>
  <SharedChartPanel :data-testid="testId" :title="title" :description="description" :loading="loading" :empty="!hasData" :empty-text="emptyText" :span="span" :size="size">
    <template #default="{ height }">
      <DashboardChart :chart="chart" :variant="variant" :accessible-label="title" :height="height" />
    </template>
  </SharedChartPanel>
</template>
