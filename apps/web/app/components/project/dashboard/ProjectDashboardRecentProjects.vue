<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { projectStatusBadge } from '@/composables/projectStatus'
import { badgeLabel } from '@/utils/statusBadge'
import type { TableColumn } from '@nuxt/ui'
import { formatNullablePercent } from '@/utils/projectFinance'
import type { DashboardProject } from '@/utils/projectChartData'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import { formatNasqDateTime } from '@/composables/calendarDate'

const props = defineProps<{ rows: readonly DashboardProject[] }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const route = useRoute()
const { entryTo } = useProjectWorkspaceMemory()
const rows = computed(() => props.rows.slice(0, 5))

const projectListQuery = computed(() => ({
  q: typeof route.query.q === 'string' && route.query.q.trim() ? route.query.q : undefined,
  status: typeof route.query.status === 'string' ? route.query.status : undefined,
}))
const columns = computed<TableColumn<DashboardProject>[]>(() => [
  { id: 'record', header: t('app.recordNumber') },
  { id: 'project', header: t('projects.dashboard.recentProject') },
  { id: 'status', header: t('projects.dashboard.recentStatus') },
  { id: 'progress', header: t('projects.dashboard.recentProgress') },
  { id: 'updated', header: t('projects.dashboard.recentUpdated') },
])

function updatedAt(value: string | null | undefined) {
  if (!value) return t('projects.dashboard.unknown')
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? t('projects.dashboard.unknown') : formatNasqDateTime(date, locale.value)
}
</script>

<template>
  <SharedRecordSection id="project-dashboard-recent" class="min-w-0" :title="t('projects.dashboard.recentTitle')" :description="t('projects.dashboard.recentDescription')">
    <template #actions>
      <UButton color="neutral" variant="outline" :to="{ path: '/projects', query: projectListQuery }" :label="t('projects.dashboard.allProjects')" />
    </template>
    <SharedDataTable :rows="[...rows]" :columns="columns" :row-key="row => row.project.id" :empty-text="t('projects.dashboard.noRecentProjects')" :caption="t('projects.dashboard.recentTitle')">
      <template #record-cell="{ row }"><RecordNumber :value="row.original.project.id" /></template>
      <template #project-cell="{ row }">
        <div data-testid="recent-project-row">
          <NuxtLink class="font-medium text-highlighted hover:underline" :to="entryTo(row.original.project.id, route.fullPath)">{{ row.original.project.name }}</NuxtLink>
        </div>
      </template>
      <template #status-cell="{ row }"><SharedStatusBadge v-bind="projectBadge(row.original.project.status)" data-testid="project-status" /></template>
      <template #progress-cell="{ row }"><span dir="ltr" class="tabular-nums">{{ formatNullablePercent(row.original.progress, t('projects.dashboard.unavailable')) }}</span></template>
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
            <div><dt class="text-muted">{{ t('projects.dashboard.recentUpdated') }}</dt><dd><time v-if="row.updated_at" :datetime="row.updated_at" dir="ltr">{{ updatedAt(row.updated_at) }}</time><span v-else>{{ updatedAt(row.updated_at) }}</span></dd></div>
          </dl>
        </div>
      </template>
    </SharedDataTable>
  </SharedRecordSection>
</template>
