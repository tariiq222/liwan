<script setup lang="ts">
// One chart on a dashboard (Tasmim Plan 4): a titled card whose body is the chart in
// the default slot, a loading placeholder, or one empty line. `emptyText` is that line
// when the chart has its own words ("no budget set yet"); without it the generic
// states.chartEmpty shows. It draws no chart itself, so SharedDashboardChart or any
// other figure goes in the slot; `actions` sits at the header's inline end (a currency
// or period select). In SharedDashboardPage a wide chart spans both columns with
// class="@min-[768px]:col-span-2".
const props = withDefaults(defineProps<{
  title: string
  description?: string
  loading?: boolean
  empty?: boolean
  emptyText?: string
}>(), {
  loading: false,
  empty: false,
})
const { t } = useI18n()
const titleId = useId()
const emptyLine = computed(() => props.emptyText?.trim() || t('states.chartEmpty'))
</script>

<template>
  <UCard as="section" data-template="chart-panel" class="min-w-0 overflow-hidden" :aria-labelledby="titleId" :aria-busy="props.loading || undefined">
    <template #header>
      <div class="flex w-full flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 :id="titleId" class="text-lg font-semibold leading-6 text-highlighted">{{ props.title }}</h2>
          <p v-if="props.description" class="mt-1 text-sm leading-6 text-muted">{{ props.description }}</p>
        </div>
        <div v-if="$slots.actions" data-template="chart-panel-actions" class="flex shrink-0 items-center gap-2">
          <slot name="actions" />
        </div>
      </div>
    </template>
    <div v-if="props.loading" role="status" :aria-label="t('app.loading')" class="grid min-h-56 place-items-center">
      <USkeleton class="h-44 w-full" />
    </div>
    <p v-else-if="props.empty" class="flex min-h-56 items-center justify-center text-center text-sm text-muted">{{ emptyLine }}</p>
    <div v-else class="min-w-0">
      <slot />
    </div>
  </UCard>
</template>
