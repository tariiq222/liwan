<script setup lang="ts">
import type { ProjectStatus } from '@webvue/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@webvue/ui/app/utils/statusBadge'
import type { TableColumn } from '@nuxt/ui'
import { formatNullablePercent } from '@/utils/projectFinance'
import type { DashboardProject } from '@/utils/projectChartData'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { formatWebVueDateTime } from '@webvue/ui/app/composables/calendarDate'

// The dashboard's actionable table: recently updated, late (overdue tasks) and at-risk projects.
// `rows` is the recent list; `allRows` is every matching project, the source of the late and at-risk views.
const props = defineProps<{ rows: readonly DashboardProject[]; allRows?: readonly DashboardProject[] }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const route = useRoute()
const { entryTo } = useProjectWorkspaceMemory()
type AttentionView = 'recent' | 'late' | 'atRisk'
const VIEW_LIMIT = 8
const view = ref<AttentionView>('recent')
const updatedById = computed(() => new Map(props.rows.map(row => [row.project.id, row.updated_at])))
const pool = computed(() => (props.allRows ?? props.rows).map(row => ({ ...row, updated_at: row.updated_at ?? updatedById.value.get(row.project.id) })))
const lateRows = computed(() => pool.value.filter(row => (row.overdue_task_count ?? 0) > 0).sort((a, b) => (b.overdue_task_count ?? 0) - (a.overdue_task_count ?? 0)))
const atRiskRows = computed(() => pool.value.filter(row => row.project.status === 'at_risk' || row.project.status === 'off_track'))
const viewRows = computed(() => ({
  recent: props.rows.slice(0, 5),
  late: lateRows.value.slice(0, VIEW_LIMIT),
  atRisk: atRiskRows.value.slice(0, VIEW_LIMIT),
}))
const rows = computed(() => viewRows.value[view.value])
const tabs = computed(() => [
  { value: 'recent', label: t('projects.dashboard.attention.tabRecent') },
  { value: 'late', label: t('projects.dashboard.attention.tabLate'), badge: lateRows.value.length },
  { value: 'atRisk', label: t('projects.dashboard.attention.tabAtRisk'), badge: atRiskRows.value.length },
])
const emptyText = computed(() => view.value === 'late'
  ? t('projects.dashboard.attention.emptyLate')
  : view.value === 'atRisk' ? t('projects.dashboard.attention.emptyAtRisk') : t('projects.dashboard.noRecentProjects'))

const projectListQuery = computed(() => ({
  q: typeof route.query.q === 'string' && route.query.q.trim() ? route.query.q : undefined,
  status: typeof route.query.status === 'string' ? route.query.status : undefined,
}))
const columns = computed<TableColumn<DashboardProject>[]>(() => [
  { id: 'record', header: t('app.recordNumber') },
  { id: 'project', header: t('projects.dashboard.recentProject') },
  { id: 'status', header: t('projects.dashboard.recentStatus') },
  { id: 'progress', header: t('projects.dashboard.recentProgress') },
  { id: 'overdue', header: t('projects.dashboard.attention.overdueTasks') },
  { id: 'updated', header: t('projects.dashboard.recentUpdated') },
])

function updatedAt(value: string | null | undefined) {
  if (!value) return t('projects.dashboard.unknown')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? t('projects.dashboard.unknown') : formatWebVueDateTime(date, locale.value)
}
</script>

<template>
  <SharedRecordSection id="project-dashboard-recent" class="min-w-0" :title="t('projects.dashboard.attention.title')" :description="t('projects.dashboard.attention.description')">
    <template #actions>
      <UButton color="neutral" variant="outline" :to="{ path: '/projects', query: projectListQuery }" :label="t('projects.dashboard.allProjects')" />
    </template>
    <UTabs v-model="view" :items="tabs" :content="false" variant="pill" size="sm" color="primary" :aria-label="t('projects.dashboard.attention.tabsLabel')" data-testid="project-dashboard-attention-tabs" class="mb-3 w-full" />
    <SharedDataTable :rows="[...rows]" :columns="columns" :row-key="row => row.project.id" :empty-text="emptyText" :caption="t('projects.dashboard.attention.title')">
      <template #record-cell="{ row }"><RecordNumber :value="row.original.project.id" /></template>
      <template #project-cell="{ row }">
        <div data-testid="recent-project-row">
          <NuxtLink class="font-medium text-highlighted hover:underline" :to="entryTo(row.original.project.id, route.fullPath)">{{ row.original.project.name }}</NuxtLink>
        </div>
      </template>
      <template #status-cell="{ row }"><SharedStatusBadge v-bind="projectBadge(row.original.project.status)" data-testid="project-status" /></template>
      <template #progress-cell="{ row }">
        <div class="flex min-w-28 items-center gap-2">
          <UProgress v-if="row.original.progress != null" :model-value="row.original.progress" size="xs" color="primary" class="w-16" aria-hidden="true" />
          <span dir="ltr" class="tabular-nums">{{ formatNullablePercent(row.original.progress, t('projects.dashboard.unavailable')) }}</span>
        </div>
      </template>
      <template #overdue-cell="{ row }">
        <span v-if="(row.original.overdue_task_count ?? 0) > 0" class="font-medium tabular-nums text-error">{{ row.original.overdue_task_count }}</span>
        <span v-else class="text-muted">—</span>
      </template>
      <template #updated-cell="{ row }">
        <time v-if="row.original.updated_at" :datetime="row.original.updated_at" dir="ltr" class="text-sm text-muted">{{ updatedAt(row.original.updated_at) }}</time>
        <span v-else class="text-sm text-muted">{{ updatedAt(row.original.updated_at) }}</span>
      </template>
      <template #mobile-row="{ row }">
        <div data-testid="recent-project-card" class="grid gap-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <RecordNumber :value="row.project.id" />
              <NuxtLink class="mt-1 block font-medium text-highlighted hover:underline" :to="entryTo(row.project.id, route.fullPath)">{{ row.project.name }}</NuxtLink>
            </div>
            <SharedStatusBadge v-bind="projectBadge(row.project.status)" data-testid="project-status" />
          </div>
          <dl class="grid grid-cols-2 gap-3 text-xs">
            <div><dt class="text-muted">{{ t('projects.dashboard.recentProgress') }}</dt><dd dir="ltr" class="tabular-nums">{{ formatNullablePercent(row.progress, t('projects.dashboard.unavailable')) }}</dd></div>
            <div v-if="(row.overdue_task_count ?? 0) > 0"><dt class="text-muted">{{ t('projects.dashboard.attention.overdueTasks') }}</dt><dd class="font-medium tabular-nums text-error">{{ row.overdue_task_count }}</dd></div>
            <div><dt class="text-muted">{{ t('projects.dashboard.recentUpdated') }}</dt><dd><time v-if="row.updated_at" :datetime="row.updated_at" dir="ltr">{{ updatedAt(row.updated_at) }}</time><span v-else>{{ updatedAt(row.updated_at) }}</span></dd></div>
          </dl>
        </div>
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
