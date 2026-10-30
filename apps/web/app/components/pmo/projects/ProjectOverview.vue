<script setup lang="ts">
import type { ProjectDetail, ProjectStatus } from '@liwan/contracts'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { isGateAction } from '@/composables/projectPhase'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'

// The main column of the project record: the tiles (progress, tasks, milestones, followers), tasks that need
// attention, the latest update. Status and manager are shown once, by the
// workspace frame, and are changed only in project settings.
const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const route = useRoute()
const { can } = useAccess()
// The tasks section is refused without `pmo.tasks.read` and does not exist on an archived project: skip its request and its links.
const canReadTasks = computed(() => can('pmo.tasks.read'))
const showTasks = computed(() => canReadTasks.value && props.project.active)
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

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <div data-testid="project-overview" class="@container flex min-w-0 flex-col gap-(--liwan-gap-card)">
    <ProjectOverviewTasks v-if="showTasks" :project-id="project.id" :return-to="route.fullPath" :gate-action="isGateAction(project.phase_state, project.can_manage, project.active)" />

    <!-- One tile grid: two columns on phones, three from a roomy container; the headline figure spans two cells. -->
    <section class="grid grid-cols-2 gap-(--liwan-gap-card) @2xl:grid-cols-3">
      <SharedMetricTile
        class="col-span-2"
        data-testid="project-overview-progress"
        density="compact"
        emphasis
        icon="i-lucide-chart-no-axes-column-increasing"
        :label="t('projects.overview.progress')"
        :value="project.progress"
        unit="%"
        value-dir="ltr"
        :hint="canReadTasks ? t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) : undefined"
      >
        <SharedProgress class="mt-1.5" size="md" :value="project.progress" :label="t('projects.overview.progress')" />
      </SharedMetricTile>
      <SharedMetricTile
        v-if="canReadTasks"
        class="max-sm:col-span-2"
        density="compact"
        icon="i-lucide-list-checks"
        :label="t('projects.overview.openTasks')"
        :value="openTaskCount"
        :to="project.active ? `/projects/${project.id}/tasks` : undefined"
      />
      <SharedRecordSection v-if="milestones.error.value" variant="panel" data-testid="project-overview-milestone-error" :title="t('projects.overview.nextMilestone')">
        <SharedPageState :error="milestones.error.value" @retry="milestones.refetch()" />
      </SharedRecordSection>
      <SharedLoadingSkeleton v-else-if="milestones.isLoading.value" :count="1" />
      <!-- Localized Arabic dates contain bidi marks; preserve the locale direction. -->
      <SharedMetricTile
        v-else
        density="compact"
        icon="i-lucide-flag"
        :label="t('projects.overview.nextMilestone')"
        :value="nearestMilestone ? dateLabel(nearestMilestone.deadline) : null"
        :hint="nearestMilestone?.name ?? t(project.milestone_count === 0 ? 'projects.overview.noMilestones' : 'projects.overview.noUpcomingMilestone')"
        :to="`/projects/${project.id}/milestones`"
      />
      <SharedMetricTile
        density="compact"
        icon="i-lucide-milestone"
        :label="t('projects.overview.milestones')"
        :value="project.milestone_count"
        :to="`/projects/${project.id}/milestones`"
      />
      <SharedMetricTile
        density="compact"
        icon="i-lucide-users"
        :label="t('projects.overview.followers')"
        :value="project.followers_count"
      />
    </section>

    <SharedRecordSection variant="panel" data-testid="project-overview-latest-update" :title="t('projects.overview.latestUpdate')">
      <template #actions>
        <NuxtLink :to="`/projects/${project.id}/updates`" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">
          {{ t('projects.refresh.workspace.viewAllUpdates') }}
        </NuxtLink>
      </template>
      <SharedLoadingSkeleton v-if="updates.isLoading.value" :count="1" />
      <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
      <div v-else-if="latestUpdate" class="grid min-w-0 gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <SharedStatusBadge v-bind="projectBadge(latestUpdate.status)" />
          <span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span>
        </div>
        <p class="flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <SharedPersonAvatar :people="[latestUpdate.author]" />
          <span>{{ latestUpdate.author.name }}</span>
          <span aria-hidden="true">·</span>
          <bdi>{{ dateLabel(latestUpdate.date) }}</bdi>
        </p>
      </div>
      <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
    </SharedRecordSection>
  </div>
</template>
