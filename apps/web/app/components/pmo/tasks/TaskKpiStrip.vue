<script setup lang="ts">
import { kpiSharesApply } from './kpiShares'
import type { KpiTile } from '@webvue/ui/app/utils/kpiTile'
import { useTaskSummary, type TaskListParams } from '@/composables/useTasks'

// The four figures above a task list: total, open, overdue and done for the tasks the list filters select. Compact
// tiles; the share line and bar are the count's percentage of the total (the total tile shows the completion share). When the
// filters decide the shares (an overdue deadline, a state selection) the tiles show the count only, all four alike. Not interactive.
const props = defineProps<{ params: TaskListParams }>()
const { t } = useI18n()
const paramsRef = computed(() => props.params)
const { data, isError, error, refetch } = useTaskSummary(paramsRef)

const sharesApply = computed(() => kpiSharesApply(props.params))
const percent = (count: number) => sharesApply.value && data.value && data.value.total > 0 ? Math.round((count / data.value.total) * 100) : undefined
const share = (count: number) => { const value = percent(count); return value === undefined ? undefined : { progress: value, hint: t('tasks.kpi.percentOfTotal', { percent: value }) } }
// The total tile's bar is the completion share, so the four tiles read alike; no bar and no caption for an empty list.
const done = computed(() => { const value = data.value && percent(data.value.done); return value === undefined ? undefined : { progress: value, hint: t('tasks.kpi.percentDone', { percent: value }) } })
const tiles = computed<KpiTile[]>(() => data.value ? [
  { id: 'total', label: t('tasks.kpi.total'), icon: 'i-lucide-list-checks', tone: 'neutral', value: data.value.total, ...done.value },
  { id: 'open', label: t('tasks.kpi.open'), icon: 'i-lucide-clock', tone: 'warning', value: data.value.open, ...share(data.value.open) },
  { id: 'overdue', label: t('tasks.kpi.overdue'), icon: 'i-lucide-circle-alert', tone: 'danger', value: data.value.overdue, ...share(data.value.overdue) },
  { id: 'done', label: t('tasks.kpi.done'), icon: 'i-lucide-circle-check', tone: 'success', value: data.value.done, ...share(data.value.done) },
] : [])
</script>

<template>
  <SharedErrorState v-if="isError" :error="error" data-testid="task-kpi-error" @retry="refetch()" />
  <SharedKpiStrip v-else :tiles="tiles" :loading="!data" :label="t('tasks.kpi.label')" data-testid="task-kpi-strip" />
</template>
