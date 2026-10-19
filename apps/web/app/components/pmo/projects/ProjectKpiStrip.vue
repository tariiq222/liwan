<script setup lang="ts">
import { useProjectSummary, type ProjectSummaryFilters } from '@/composables/useProjects'

// The four figures above the projects list, laid out like the task KPI strip: total, active, needing attention and done
// for the projects the list filters select. A status filter decides the shares by construction, so the tiles then show
// the count only. Not interactive.
const props = defineProps<{ filters: ProjectSummaryFilters }>()
const { t } = useI18n()
const { data } = useProjectSummary(() => props.filters)

const sharesApply = computed(() => !props.filters.status)
const percent = (count: number) => sharesApply.value && data.value && data.value.project_count > 0 ? Math.round((count / data.value.project_count) * 100) : undefined
const share = (count: number, hintKey = 'projects.kpi.percentOfTotal') => {
  const value = percent(count)
  return value === undefined ? undefined : { progress: value, hint: t(hintKey, { percent: value }) }
}
const tiles = computed(() => {
  if (!data.value) return null
  const total = data.value.project_count
  const done = data.value.status_counts.find(item => item.status === 'done')?.count ?? 0
  const attention = data.value.attention_project_count
  return [
    { key: 'total', icon: 'i-lucide-folder-kanban', tone: 'neutral', value: total, ...share(done, 'projects.kpi.percentDone') },
    { key: 'active', icon: 'i-lucide-clock', tone: 'warning', value: total - done, ...share(total - done) },
    { key: 'attention', icon: 'i-lucide-triangle-alert', tone: 'danger', value: attention, ...share(attention) },
    { key: 'done', icon: 'i-lucide-circle-check', tone: 'success', value: done, ...share(done) },
  ] as const
})
</script>

<template>
  <section class="grid grid-cols-2 gap-(--webvue-gap-card) lg:grid-cols-4" :aria-label="t('projects.kpi.label')" data-testid="project-kpi-strip">
    <template v-if="tiles">
      <SharedMetricTile
        v-for="tile in tiles"
        :key="tile.key"
        density="compact"
        :tone="tile.tone"
        :icon="tile.icon"
        :label="t(`projects.kpi.${tile.key}`)"
        :value="tile.value"
        :hint="'hint' in tile ? tile.hint : undefined"
        :progress="'progress' in tile ? tile.progress : undefined"
        value-dir="ltr"
      />
    </template>
    <template v-else>
      <USkeleton v-for="n in 4" :key="n" class="h-[4.5rem] rounded-card" />
    </template>
  </section>
</template>
