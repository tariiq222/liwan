<script setup lang="ts">
import { useTaskSummary, type TaskListParams } from '@/composables/useTasks'

// The four figures above a task list: total, open, overdue and done for the tasks the list filters select. Compact
// tiles; the share line is the count's percentage of the total (none on the total itself). Not interactive.
const props = defineProps<{ params: TaskListParams }>()
const { t } = useI18n()
const paramsRef = computed(() => props.params)
const { data } = useTaskSummary(paramsRef)

const percentOfTotal = (count: number) => t('tasks.kpi.percentOfTotal', { percent: data.value && data.value.total > 0 ? Math.round((count / data.value.total) * 100) : 0 })
const tiles = computed(() => data.value && [
  { key: 'total', label: t('tasks.kpi.total'), icon: 'i-lucide-list-checks', tone: 'neutral', value: data.value.total, hint: undefined },
  { key: 'open', label: t('tasks.kpi.open'), icon: 'i-lucide-clock', tone: 'warning', value: data.value.open, hint: percentOfTotal(data.value.open) },
  { key: 'overdue', label: t('tasks.kpi.overdue'), icon: 'i-lucide-circle-alert', tone: 'danger', value: data.value.overdue, hint: percentOfTotal(data.value.overdue) },
  { key: 'done', label: t('tasks.kpi.done'), icon: 'i-lucide-circle-check', tone: 'success', value: data.value.done, hint: percentOfTotal(data.value.done) },
] as const)
</script>

<template>
  <section class="grid grid-cols-2 gap-(--webvue-gap-card) lg:grid-cols-4" :aria-label="t('tasks.kpi.label')" data-testid="task-kpi-strip">
    <template v-if="tiles">
      <SharedMetricTile
        v-for="tile in tiles"
        :key="tile.key"
        density="compact"
        :tone="tile.tone"
        :icon="tile.icon"
        :label="tile.label"
        :value="tile.value"
        :hint="tile.hint"
        value-dir="ltr"
      />
    </template>
    <template v-else>
      <USkeleton v-for="n in 4" :key="n" class="h-[4.5rem] rounded-card" />
    </template>
  </section>
</template>
