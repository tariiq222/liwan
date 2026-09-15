<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { formatCalendarDate } from '@/composables/calendarDate'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'

const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()
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
const dateRange = computed(() => {
  if (!props.project.date_start && !props.project.date_end) return t('projects.overview.noDates')
  const format = (value: string | null) => value ? formatCalendarDate(value, locale.value) : '—'
  return `${format(props.project.date_start)} — ${format(props.project.date_end)}`
})

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <div data-testid="project-overview" class="nasq-page-width-detail project-overview space-y-6">
    <!-- Status is shown by the frame header and changed only in project settings. -->
    <p class="text-sm text-muted"><bdi>{{ dateRange }}</bdi></p>

    <section class="project-overview-stats grid gap-6">
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
      <SharedMetricTile
        icon="i-lucide-flag"
        :label="t('projects.overview.nextMilestone')"
        :value="nearestMilestone ? dateLabel(nearestMilestone.deadline) : null"
        :hint="nearestMilestone?.name ?? t('projects.overview.noUpcomingMilestone')"
      />
    </section>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />
      <UCard data-testid="project-overview-latest-update">
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-semibold text-highlighted">{{ t('projects.overview.latestUpdate') }}</h2>
            <NuxtLink
              :to="`/projects/${project.id}/updates`"
              class="text-xs text-muted underline underline-offset-4 hover:text-highlighted"
            >
              {{ t('projects.refresh.workspace.viewAllUpdates') }}
            </NuxtLink>
          </div>
        </template>
        <USkeleton v-if="updates.isLoading.value" class="h-10 w-full" />
        <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
        <div v-else-if="latestUpdate" class="grid min-w-0 gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <ProjectStatusBadge :status="latestUpdate.status" />
            <span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span>
          </div>
          <p class="flex flex-wrap gap-x-2 text-xs text-muted">
            <span>{{ latestUpdate.author.name }}</span>
            <span aria-hidden="true">·</span>
            <bdi>{{ dateLabel(latestUpdate.date) }}</bdi>
          </p>
        </div>
        <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.project-overview-stats {
  grid-template-columns: minmax(0, 1fr);
}

@container project-overview (min-width: 35rem) {
  .project-overview-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@container project-overview (min-width: 48rem) {
  .project-overview-stats {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.project-overview {
  container: project-overview / inline-size;
}
</style>
