<script setup lang="ts">
// One chart on a dashboard (Tasmim Plan 4): a titled card whose body is the chart in
// the default slot, a loading placeholder, or one empty line. `emptyText` is that line
// when the chart has its own words ("no budget set yet"); without it the generic
// states.chartEmpty shows. It draws no chart itself, so SharedDashboardChart or any
// other figure goes in the slot; `actions` sits at the header's inline end (a currency
// or period select). In SharedDashboardPage `span="full"` makes a wide chart take both columns, and
// `size` (sm 224px, md 300px, lg 360px) sets the body height; the default slot receives it as `height`
// (a CSS length) for a chart that needs its own height prop. The title is a panel title (text-sm, DESIGN.md heading ladder).
const CHART_HEIGHT = { sm: '224px', md: '300px', lg: '360px' } as const
const props = withDefaults(defineProps<{
  title: string
  description?: string
  loading?: boolean
  empty?: boolean
  emptyText?: string
  span?: 'half' | 'full'
  size?: keyof typeof CHART_HEIGHT
}>(), {
  loading: false,
  empty: false,
  span: 'half',
  size: 'md',
})
const { t } = useI18n()
const titleId = useId()
const emptyLine = computed(() => props.emptyText?.trim() || t('states.chartEmpty'))
const height = computed(() => CHART_HEIGHT[props.size])
</script>

<template>
  <UCard as="section" data-template="chart-panel" :data-span="props.span" :data-size="props.size" class="min-w-0 overflow-hidden" :class="{ '@min-[768px]:col-span-2': props.span === 'full' }" :aria-labelledby="titleId" :aria-busy="props.loading || undefined">
    <template #header>
      <div class="flex w-full flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 :id="titleId" class="text-sm font-semibold leading-6 text-highlighted">{{ props.title }}</h2>
          <p v-if="props.description" class="mt-1 text-sm leading-6 text-muted">{{ props.description }}</p>
        </div>
        <div v-if="$slots.actions" data-template="chart-panel-actions" class="flex shrink-0 items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </template>
    <div v-if="props.loading" role="status" :aria-label="t('app.loading')" class="grid place-items-center" :style="{ minHeight: height }">
      <USkeleton class="size-full" />
    </div>
    <p v-else-if="props.empty" class="flex items-center justify-center text-center text-sm text-muted" :style="{ minHeight: height }">{{ emptyLine }}</p>
    <div v-else class="min-w-0">
      <slot :height="height" />
    </div>
  </UCard>
</template>
