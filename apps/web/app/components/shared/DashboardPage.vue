<script setup lang="ts">
// The dashboard template (Tasmim Plan 4): the page header and its actions, the page's
// filters, a row of SharedMetricTile in `metrics`, then the SharedChartPanel grid. The grid
// goes two-up when its own width reaches 768px: a container query, so a wide context
// sidebar narrows it the way a phone does. Loading and errors stay with the page.
// `hideHeader` is for a page inside a frame that owns the heading.
const props = defineProps<{
  title: string
  description?: string
  hideHeader?: boolean
}>()
const { t } = useI18n()
</script>

<template>
  <SharedPageContainer width="list" data-template="dashboard-page">
    <SharedPageHeader :title="props.title" :description="props.description" :hide-title="props.hideHeader">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <div v-if="$slots.filters" data-template="dashboard-filters" class="min-w-0"><slot name="filters" /></div>
    <section v-if="$slots.metrics" :aria-label="t('states.metrics')" data-template="dashboard-metrics" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <slot name="metrics" />
    </section>
    <div class="@container min-w-0">
      <div data-template="dashboard-charts" class="grid min-w-0 gap-5 @min-[768px]:grid-cols-2">
        <slot />
      </div>
    </div>
  </SharedPageContainer>
</template>
