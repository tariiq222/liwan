<script setup lang="ts">
import type { ProjectDetail, ProjectStatus } from '@liwan/contracts'
import { formatCalendarDate } from '@liwan/ui/app/composables/calendarDate'
import { projectStatusBadge } from '@/composables/projectStatus'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { badgeLabel } from '@liwan/ui/app/utils/statusBadge'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'
import ProjectUpdateList from './ProjectUpdateList.vue'

// The main column of the project record: the updates (the latest with its post action, then the earlier ones), the basics, the tasks
// that need attention and the tiles (progress, tasks, milestones, followers). Status and manager are shown once, by the
// workspace frame, and are changed only in project settings.
const props = defineProps<{ project: ProjectDetail }>()
const { t } = useI18n()
const projectBadge = (status: ProjectStatus | null) => { const entry = projectStatusBadge(status); return { tone: entry.tone, label: badgeLabel(entry, status, t) } }
const route = useRoute()
const hydrated = useHydrated()
const { can } = useAccess()
// The tasks section is refused without `pmo.tasks.read` and does not exist on an archived project: skip its request and its links.
const canReadTasks = computed(() => can('pmo.tasks.read'))
const showTasks = computed(() => canReadTasks.value && props.project.active)
const projectId = computed(() => props.project.id)
const milestones = useMilestones(computed(() => props.project.tools.planning.enabled ? projectId.value : null))
const updates = useProjectUpdates(projectId)

const nearestMilestone = computed(() => {
  return (milestones.data.value ?? [])
    .filter(item => !item.is_reached)
    .sort((a, b) => (a.deadline ?? '9999-12-31').localeCompare(b.deadline ?? '9999-12-31'))[0] ?? null
})
const latestUpdate = computed(() => [...(updates.data.value ?? [])].sort((a, b) => b.date.localeCompare(a.date))[0] ?? null)
// Posting follows the same rule as before the updates joined the summary: a manager, on an open project.
const canPost = computed(() => props.project.can_manage && props.project.active)
const postUpdateTo = computed(() => ({ path: `/projects/${projectId.value}/updates/new`, query: returnToQuery(route.fullPath) }))
const openTaskCount = computed(() => Math.max(0, props.project.task_count - props.project.closed_task_count))

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value) : '—'
}
</script>

<template>
  <div data-testid="project-overview" class="@container flex min-w-0 flex-col gap-(--liwan-gap-card)">
    <!-- The updates come first: the latest one with the action to post another, then the earlier ones. -->
    <SharedRecordSection variant="panel" data-testid="project-overview-latest-update" :title="t('projects.overview.latestUpdate')">
      <template v-if="canPost" #actions>
        <UButton size="sm" icon="i-lucide-plus" data-testid="project-updates-create" :disabled="!hydrated" :to="postUpdateTo" :label="t('projects.updates.publish')" />
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
        <SharedRichText size="sm" :html="latestUpdate.description_html" />
      </div>
      <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
    </SharedRecordSection>
    <ProjectUpdateList :project-id="project.id" />

    <SharedRecordSection variant="panel" :title="t('projects.basics.title')" data-testid="project-overview-basics">
      <SharedRichText v-if="project.description_html" :html="project.description_html" />
      <ul v-if="project.objectives.length" class="grid gap-(--liwan-gap-card)">
        <li v-for="objective in project.objectives" :key="objective.id">
          <p class="text-sm font-medium">{{ objective.goal }}</p>
          <p v-if="objective.metric || objective.target" class="text-sm text-muted">{{ [objective.metric, objective.target].filter(Boolean).join(' · ') }}</p>
        </li>
      </ul>
      <div v-if="project.success_criteria">
        <h2 class="text-sm font-semibold">{{ t('projects.basics.successCriteria') }}</h2>
        <p class="whitespace-pre-wrap text-sm">{{ project.success_criteria }}</p>
      </div>
    </SharedRecordSection>
    <ProjectOverviewTasks v-if="showTasks" :project-id="project.id" :return-to="route.fullPath" />

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
      <SharedRecordSection v-if="project.tools.planning.enabled && milestones.error.value" variant="panel" data-testid="project-overview-milestone-error" :title="t('projects.overview.nextMilestone')">
        <SharedPageState :error="milestones.error.value" @retry="milestones.refetch()" />
      </SharedRecordSection>
      <SharedLoadingSkeleton v-else-if="project.tools.planning.enabled && milestones.isLoading.value" :count="1" />
      <!-- Localized Arabic dates contain bidi marks; preserve the locale direction. -->
      <SharedMetricTile
        v-else-if="project.tools.planning.enabled"
        density="compact"
        icon="i-lucide-flag"
        :label="t('projects.overview.nextMilestone')"
        :value="nearestMilestone ? dateLabel(nearestMilestone.deadline) : null"
        :hint="nearestMilestone?.name ?? t(project.milestone_count === 0 ? 'projects.overview.noMilestones' : 'projects.overview.noUpcomingMilestone')"
        :to="`/projects/${project.id}/milestones`"
      />
      <SharedMetricTile
        v-if="project.tools.planning.enabled"
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
  </div>
</template>
