<script setup lang="ts">
import type { DashboardChart as DashboardChartModel } from '@/utils/projectChartData'
import DashboardChart from '@/components/shared/DashboardChart.client.vue'

withDefaults(defineProps<{
  testId: string
  titleId: string
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
  <UCard :data-testid="testId" class="min-w-0 overflow-hidden" :aria-labelledby="titleId">
    <template #header>
      <div class="min-w-0 w-full">
        <h2 :id="titleId" class="text-lg font-semibold leading-6 text-highlighted">{{ title }}</h2>
        <p class="mt-1 text-sm leading-6 text-muted">{{ description }}</p>
      </div>
    </template>
    <div v-if="loading" role="status" class="flex items-center justify-center" :style="{ height }" :aria-label="$t('app.loading')">
      <USkeleton class="h-44 w-full" />
    </div>
    <div v-else-if="hasData" class="min-w-0">
      <DashboardChart :chart="chart" :variant="variant" :accessible-label="accessibleLabel" :height="height" />
    </div>
    <p v-else class="flex min-h-[220px] items-center justify-center text-center text-sm text-muted">{{ emptyText }}</p>
  </UCard>
</template>
