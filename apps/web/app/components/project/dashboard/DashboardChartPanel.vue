<script setup lang="ts">
import type { ChartOption } from '@/utils/projectChartOptions'
import ChartCanvas from '@/components/shared/ChartCanvas.client.vue'

withDefaults(defineProps<{
  testId: string
  titleId: string
  title: string
  description: string
  option: ChartOption
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
  <section :data-testid="testId" class="nasq-panel flex min-w-0 flex-col overflow-hidden" :aria-labelledby="titleId">
    <header class="nasq-panel-header items-start">
      <div class="min-w-0">
        <h2 :id="titleId">{{ title }}</h2>
        <p class="mt-1 text-sm leading-6 text-muted-foreground">{{ description }}</p>
      </div>
    </header>
    <div class="nasq-panel-body min-w-0 flex-1">
      <div v-if="loading" role="status" class="flex items-center justify-center" :style="{ height }" :aria-label="$t('app.loading')">
        <Skeleton class="h-44 w-full" />
      </div>
      <div v-else-if="hasData" class="min-w-0">
        <ChartCanvas :option="option" :accessible-label="accessibleLabel" :height="height" />
      </div>
      <p v-else class="flex min-h-[220px] items-center justify-center text-center text-sm text-muted-foreground">{{ emptyText }}</p>
    </div>
  </section>
</template>
