<script lang="ts">
import type { HTMLAttributes } from "vue"
import type { ChartConfig } from "."
import { computed, useId } from "vue"
import ChartStyle from "./ChartStyle.vue"
</script>

<script setup lang="ts">
const props = defineProps<{
  id?: HTMLAttributes["id"]
  class?: HTMLAttributes["class"]
  config: ChartConfig
  cursor?: boolean
}>()

defineSlots<{
  default: {
    id: string
    config: ChartConfig
  }
}>()

const uniqueId = useId()
const chartId = computed(() => `chart-${props.id || uniqueId.replace(/:/g, "")}`)
</script>

<template>
  <div
    data-slot="chart"
    :data-chart="chartId"
    :class="[
      `[&_.tick_text]:!fill-muted-foreground [&_.tick_line]:!stroke-border/50 flex min-h-0 flex-col justify-center text-xs [&_[data-vis-xy-container]]:w-full [&_[data-vis-single-container]]:w-full h-full w-full `,
      props.class,
    ]"
    :style="{
      '--vis-tooltip-padding': '0px',
      '--vis-tooltip-background-color': 'transparent',
      '--vis-tooltip-border-color': 'transparent',
      '--vis-tooltip-text-color': 'none',
      '--vis-tooltip-shadow-color': 'none',
      '--vis-tooltip-backdrop-filter': 'none',
      '--vis-crosshair-circle-stroke-color': '#0000',
      '--vis-crosshair-line-stroke-width': cursor ? '1px' : '0px',
      '--vis-font-family': 'var(--font-sans)',
      '--vis-axis-font-family': 'var(--font-sans)',
      '--vis-axis-tick-color': 'var(--border)',
      '--vis-axis-domain-color': 'var(--border)',
      '--vis-axis-grid-color': 'var(--border)',
      '--vis-axis-label-color': 'var(--muted-foreground)',
      '--vis-axis-tick-label-color': 'var(--muted-foreground)',
      '--vis-dark-axis-tick-color': 'var(--border)',
      '--vis-dark-axis-domain-color': 'var(--border)',
      '--vis-dark-axis-tick-label-color': 'var(--muted-foreground)',
      '--vis-dark-axis-grid-color': 'var(--border)',
      '--vis-dark-axis-label-color': 'var(--muted-foreground)',
      '--vis-donut-central-label-text-color': 'var(--foreground)',
      '--vis-donut-central-sub-label-text-color': 'var(--muted-foreground)',
      '--vis-donut-background-color': 'var(--card)',
      '--vis-dark-donut-central-label-text-color': 'var(--foreground)',
      '--vis-dark-donut-central-sub-label-text-color': 'var(--muted-foreground)',
      '--vis-dark-donut-background-color': 'var(--card)',
    }"
  >
    <slot :id="uniqueId" :config="props.config" />
    <ChartStyle :id="chartId" :config="props.config" />
  </div>
</template>
