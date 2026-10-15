<script setup lang="ts">
import type { ProjectDetail, ProjectStatus } from '@nasq/contracts'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { badgeLabel } from '@/utils/statusBadge'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'

// The main column of the project record: progress figures, tasks that need attention, the latest
// update. The page puts the properties in the record's aside. Status and manager are shown once, by the
// workspace frame, and are changed only in project settings.
const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const route = useRoute()
const projectId = computed(() => props.project.id)
const milestones = useMilestones(projectId)
const updates = useProjectUpdates(projectId)

const nearestMilestone = computed(() => {
  return (milestones.data.value ?? [])
    .filter(item => !item.is_reached)
    .sort((a, b) => (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31'))[0] ?? null
})
const latestUpdate = computed(() => [...(updates.data.value ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null)
const openTaskCount = computed(() => Math.max(0, props.project.task_count - props.project.closed_task_count))

const metricGridClass = 'grid grid-cols-2 gap-3 @min-[36rem]:grid-cols-3 @min-[36rem]:gap-6 [&>:last-child:nth-child(odd)]:col-span-2 @min-[36rem]:[&>:last-child:nth-child(odd)]:col-span-1 max-sm:[&_[data-slot=body]]:gap-2 max-sm:[&_[data-slot=body]]:p-3 max-sm:[&_[data-slot=body]>span]:hidden'

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <div data-testid="project-overview" class="@container min-w-0 space-y-6">
    <!-- Two columns from the narrowest width, compact tiles on phones; the odd one out spans the row. -->
    <section :class="metricGridClass">
      <SharedMetricTile
        icon="i-lucide-chart-no-axes-column-increasing"
        :label="t('projects.overview.progress')"
        :value="project.progress"
        unit="%"
        value-dir="ltr"
        :hint="t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count })"
      >
        <UProgress :model-value="project.progress" class="mt-2" size="sm" />
      </SharedMetricTile>
      <SharedMetricTile
        icon="i-lucide-list-checks"
        :label="t('projects.overview.openTasks')"
        :value="openTaskCount"
        :hint="t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count })"
      />
      <!-- Localized Arabic dates contain bidi marks; preserve the locale direction. -->
      <SharedMetricTile
        :label="t('projects.overview.nextMilestone')"
        :value="nearestMilestone ? dateLabel(nearestMilestone.deadline) : null"
        :hint="nearestMilestone?.name ?? t(project.milestone_count === 0 ? 'projects.overview.noMilestones' : 'projects.overview.noUpcomingMilestone')"
      />
    </section>

    <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />

    <SharedRecordSection panel data-testid="project-overview-latest-update" :title="t('projects.overview.latestUpdate')">
      <template #actions>
        <NuxtLink :to="`/projects/${project.id}/updates`" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">
          {{ t('projects.refresh.workspace.viewAllUpdates') }}
        </NuxtLink>
      </template>
      <div>
        <SharedLoadingSkeleton v-if="updates.isLoading.value" :count="1" />
        <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
        <div v-else-if="latestUpdate" class="grid min-w-0 gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <SharedStatusBadge v-bind="projectBadge(latestUpdate.status)" />
            <span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span>
          </div>
          <p class="flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{{ latestUpdate.author.name }}</span>
            <span aria-hidden="true">·</span>
            <bdi>{{ dateLabel(latestUpdate.date) }}</bdi>
          </p>
        </div>
        <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
      </div>
    </SharedRecordSection>
  </div>
</template>
