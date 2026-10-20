<script setup lang="ts">
// The dashboard template (Tasmim Plan 4): the page header and its actions, the page's
// filters, the page's one call to action in `primary` (full width, a SharedRecordSection `action`), a row of
// SharedMetricTile in `metrics`, then the SharedChartPanel grid. Gaps are the card gap token; sections are the section gap. The grid
// goes two-up when its own width reaches 768px: a container query, so a wide context
// sidebar narrows it the way a phone does. Loading and errors stay with the page.
// `hideHeader` is for a page inside a frame that owns the heading.
import type { PageHeaderTag } from '../../../utils/pageHeaderTag'

const props = defineProps<{
  title: string
  tags?: PageHeaderTag[]
  hideHeader?: boolean
  /** The metrics row is the page's KPI strip: the header draws the show/hide toggle and the row follows it. */
  kpiToggle?: boolean
}>()
const { t } = useI18n()
const { shown: kpisShown } = useKpiVisibility()
</script>

<template>
  <SharedPageContainer width="list" data-template="dashboard-page">
    <SharedPageHeader :title="props.title" :tags="props.tags" :hide-title="props.hideHeader" :kpi-toggle="props.kpiToggle">
      <template v-if="$slots.actions" #actions>
        <slot name="actions" />
      </template>
    </SharedPageHeader>
    <div v-if="$slots.filters" data-template="dashboard-filters" class="min-w-0"><slot name="filters" /></div>
    <div v-if="$slots.primary" data-template="dashboard-primary" class="min-w-0"><slot name="primary" /></div>
    <section v-if="$slots.metrics && (!props.kpiToggle || kpisShown)" :aria-label="t('states.metrics')" data-template="dashboard-metrics" class="grid gap-(--webvue-gap-card) sm:grid-cols-2 xl:grid-cols-4">
      <slot name="metrics" />
    </section>
    <div class="@container min-w-0">
      <div data-template="dashboard-charts" class="grid min-w-0 gap-(--webvue-gap-card) @min-[768px]:grid-cols-2">
        <slot />
      </div>
    </div>
  </SharedPageContainer>
</template>
