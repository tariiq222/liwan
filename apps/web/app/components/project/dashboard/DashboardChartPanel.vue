<script setup lang="ts">
import type { DashboardChart as DashboardChartModel } from '@/utils/projectChartData'
import DashboardChart from '@/components/shared/DashboardChart.client.vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
  <Card :data-testid="testId" class="min-w-0 overflow-hidden" :aria-labelledby="titleId">
    <CardHeader class="items-center border-b-0 pb-0 text-center">
      <div class="min-w-0">
        <CardTitle :id="titleId">{{ title }}</CardTitle>
        <CardDescription class="mt-1 leading-6">{{ description }}</CardDescription>
      </div>
    </CardHeader>
    <CardContent class="min-w-0 flex-1">
      <div v-if="loading" role="status" class="flex items-center justify-center" :style="{ height }" :aria-label="$t('app.loading')">
        <Skeleton class="h-44 w-full" />
      </div>
      <div v-else-if="hasData" class="min-w-0">
        <DashboardChart :chart="chart" :variant="variant" :accessible-label="accessibleLabel" :height="height" />
      </div>
      <p v-else class="flex min-h-[220px] items-center justify-center text-center text-sm text-muted-foreground">{{ emptyText }}</p>
    </CardContent>
  </Card>
</template>
