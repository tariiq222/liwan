<script setup lang="ts">
import type { BaselineTaskVariance } from '@liwan/contracts'
import { varianceLabel, varianceTone } from './variance'

// One row per task of the baseline: its planned dates, where it stands now, and how many days it moved.
const props = defineProps<{ rows: readonly BaselineTaskVariance[]; projectId: number }>()
const { t } = useI18n()
const columns = computed(() => [
  { id: 'name', header: t('projects.baselines.fields.task'), meta: { class: { th: 'min-w-48', td: 'max-w-0 min-w-48 truncate' } } },
  { id: 'baseline', header: t('projects.baselines.fields.baselineDates'), meta: { class: { th: 'w-52', td: 'w-52 whitespace-nowrap' } } },
  { id: 'current', header: t('projects.baselines.fields.currentDates'), meta: { class: { th: 'w-52', td: 'w-52 whitespace-nowrap' } } },
  { id: 'variance', header: t('projects.baselines.fields.variance'), meta: { class: { th: 'w-32', td: 'w-32' } } },
])
// A removed task has no id: its position keeps the row key unique.
const keyed = computed(() => props.rows.map((row, index) => ({ ...row, key: row.task_id ? `t${row.task_id}` : `r${index}` })))
const range = (start: string | null, end: string | null) => start || end ? `${start ?? '—'} → ${end ?? '—'}` : t('projects.baselines.undated')
// A removed task has left the project: its row has no link and says so.
const taskTo = (row: BaselineTaskVariance) => row.task_id && row.status !== 'removed' ? `/projects/${props.projectId}/tasks/${row.task_id}` : undefined
const tag = (row: BaselineTaskVariance) => row.status === 'removed' ? t('projects.baselines.removed') : row.status === 'added' ? t('projects.baselines.added') : row.archived ? t('projects.baselines.archived') : ''
</script>

<template>
  <SharedDataTable bare :rows="keyed" :columns="columns" row-key="key" :caption="t('projects.baselines.variance.tableCaption')" data-testid="baseline-variance-table">
    <template #name-cell="{ row }">
      <NuxtLink v-if="taskTo(row.original)" :to="taskTo(row.original)" class="block truncate font-semibold text-highlighted hover:underline">{{ row.original.name }}<span v-if="tag(row.original)" class="font-normal text-muted"> · {{ tag(row.original) }}</span></NuxtLink>
      <span v-else class="block truncate text-muted">{{ row.original.name }} · {{ tag(row.original) }}</span>
    </template>
    <template #baseline-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ range(row.original.baseline_start, row.original.baseline_end) }}</span></template>
    <template #current-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ row.original.status === 'removed' ? '—' : range(row.original.current_start, row.original.current_end) }}</span></template>
    <template #variance-cell="{ row }">
      <SharedStatusBadge v-if="varianceLabel(row.original.end_variance_days)" :tone="varianceTone(row.original.end_variance_days)" :label="t('projects.baselines.variance.days', { days: varianceLabel(row.original.end_variance_days) })" />
      <span v-else class="text-muted">—</span>
    </template>
    <template #mobile-row="{ row: item }">
      <div class="space-y-2">
        <div class="flex items-start justify-between gap-3">
          <NuxtLink v-if="taskTo(item)" :to="taskTo(item)" class="block font-semibold text-highlighted hover:underline">{{ item.name }}<span v-if="tag(item)" class="font-normal text-muted"> · {{ tag(item) }}</span></NuxtLink>
          <span v-else class="font-semibold text-muted">{{ item.name }} · {{ tag(item) }}</span>
          <SharedStatusBadge v-if="varianceLabel(item.end_variance_days)" :tone="varianceTone(item.end_variance_days)" :label="t('projects.baselines.variance.days', { days: varianceLabel(item.end_variance_days) })" />
        </div>
        <dl class="grid grid-cols-2 gap-x-3 text-sm">
          <div><dt class="text-xs text-muted">{{ t('projects.baselines.fields.baselineDates') }}</dt><dd dir="ltr" class="tabular-nums">{{ range(item.baseline_start, item.baseline_end) }}</dd></div>
          <div><dt class="text-xs text-muted">{{ t('projects.baselines.fields.currentDates') }}</dt><dd dir="ltr" class="tabular-nums">{{ item.status === 'removed' ? '—' : range(item.current_start, item.current_end) }}</dd></div>
        </dl>
      </div>
    </template>
  </SharedDataTable>
</template>
