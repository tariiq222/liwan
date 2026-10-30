<script setup lang="ts">
import type { KpiTile } from '@liwan/ui/app/utils/kpiTile'
import { useProjectSummary, type ProjectSummaryFilters } from '@/composables/useProjects'

// The four figures above the projects list, laid out like the task KPI strip: total, active, needing attention and done
// for the projects the list filters select. A status filter decides the shares by construction, so the tiles then show
// the count only. Not interactive.
const props = defineProps<{ filters: ProjectSummaryFilters }>()
const { t } = useI18n()
const { data, isError, error, refetch } = useProjectSummary(() => props.filters)

const sharesApply = computed(() => !props.filters.status)
const percent = (count: number) => sharesApply.value && data.value && data.value.project_count > 0 ? Math.round((count / data.value.project_count) * 100) : undefined
const share = (count: number, hintKey = 'projects.kpi.percentOfTotal') => {
  const value = percent(count)
  return value === undefined ? undefined : { progress: value, hint: t(hintKey, { percent: value }) }
}
const tiles = computed<KpiTile[]>(() => {
  if (!data.value) return []
  const total = data.value.project_count
  const done = data.value.status_counts.find(item => item.status === 'done')?.count ?? 0
  const attention = data.value.attention_project_count
  return [
    { id: 'total', label: t('projects.kpi.total'), icon: 'i-lucide-folder-kanban', tone: 'neutral', value: total, ...share(done, 'projects.kpi.percentDone') },
    { id: 'active', label: t('projects.kpi.active'), icon: 'i-lucide-clock', tone: 'warning', value: total - done, ...share(total - done) },
    { id: 'attention', label: t('projects.kpi.attention'), icon: 'i-lucide-triangle-alert', tone: 'danger', value: attention, ...share(attention) },
    { id: 'done', label: t('projects.kpi.done'), icon: 'i-lucide-circle-check', tone: 'success', value: done, ...share(done) },
  ]
})
</script>

<template>
  <SharedErrorState v-if="isError && !data" :error="error" data-testid="project-kpi-error" @retry="refetch()" />
  <SharedKpiStrip v-else :tiles="tiles" :loading="!data" :label="t('projects.kpi.label')" data-testid="project-kpi-strip" />
</template>
