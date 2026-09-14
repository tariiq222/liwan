<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { getLocalTimeZone, today } from '@internationalized/date'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { STATUS_COLOR } from '@/utils/statusTone'
import { sanitizeHtml } from '@/utils/sanitize'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'

const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()
const route = useRoute()
function previewHtml(value: string) {
  return sanitizeHtml(value).replace(/<(\/?)h[1-6](\s[^>]*)?>/gi, '<$1h4$2>')
}
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
function isOverdue(value: string | null) {
  const deadline = toCalendarDate(value)
  return deadline ? deadline.compare(today(getLocalTimeZone())) < 0 : false
}
</script>

<template>
  <div data-testid="project-overview" class="nasq-page-width-detail project-overview space-y-6">
    <div class="flex flex-wrap items-center gap-3 text-sm">
      <ProjectStatusSelect v-if="project.can_manage" :project="project" />
      <ProjectStatusBadge v-else :status="project.status" />
      <span class="text-muted">{{ dateRange }}</span>
      <p class="flex items-center gap-1 text-xs text-muted"><span>{{ t('app.recordNumber') }}</span><RecordNumber :value="project.id" /></p>
      <NuxtLink :to="{ path: '/meetings', query: { project_id: String(project.id), returnTo: route.fullPath } }" class="text-brand-link underline underline-offset-4">
        {{ t('nav.meetings') }}
      </NuxtLink>
    </div>

    <section class="project-overview-stats grid gap-6">
      <UCard>
        <div class="flex items-center gap-2 text-sm text-muted"><UIcon name="i-lucide-list-checks" class="size-4" />{{ t('projects.overview.progress') }}</div>
        <p class="mt-2 text-3xl font-semibold tabular-nums">{{ project.progress }}%</p>
        <UProgress :model-value="project.progress" class="mt-3" size="sm" />
        <p class="mt-1 text-xs text-muted">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
      </UCard>
      <UCard>
        <div class="flex items-center gap-2 text-sm text-muted"><UIcon name="i-lucide-list-checks" class="size-4" />{{ t('projects.overview.openTasks') }}</div>
        <p class="mt-2 text-3xl font-semibold tabular-nums">{{ openTaskCount }}</p>
        <p class="mt-1 text-xs text-muted">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
      </UCard>
      <UCard>
        <div class="flex items-center gap-2 text-sm text-muted"><UIcon name="i-lucide-flag" class="size-4" />{{ t('projects.overview.nextMilestone') }}</div>
        <p class="mt-2 text-3xl font-semibold">{{ nearestMilestone ? dateLabel(nearestMilestone.deadline) : '—' }}</p>
        <p class="mt-1 text-xs text-muted">{{ nearestMilestone?.name ?? t('projects.overview.noUpcomingMilestone') }}</p>
      </UCard>
    </section>

    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
      <div class="space-y-6">
        <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <h2 class="text-lg font-semibold text-highlighted">{{ t('projects.overview.latestUpdate') }}</h2>
              <NuxtLink
                :to="{ path: `/projects/${project.id}/updates`, query: { returnTo: route.fullPath } }"
                class="text-xs text-muted underline underline-offset-4 hover:text-highlighted"
              >
                {{ t('projects.refresh.workspace.viewAllUpdates') }}
              </NuxtLink>
            </div>
          </template>
          <USkeleton v-if="updates.isLoading.value" class="h-10 w-full" />
          <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
          <template v-else-if="latestUpdate">
            <div class="flex items-center gap-2"><ProjectStatusBadge :status="latestUpdate.status" /><span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span></div>
            <p class="mt-1 text-xs text-muted">{{ latestUpdate.author.name }} · {{ dateLabel(latestUpdate.date) }}</p>
            <div class="prose prose-sm mt-2 max-w-none break-words text-sm" v-html="previewHtml(latestUpdate.description_html)" />
          </template>
          <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
        </UCard>
      </div>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="flex items-center gap-2 text-lg font-semibold text-highlighted"><UIcon name="i-lucide-calendar-clock" class="size-4" />{{ t('projects.overview.deliveryMilestones') }}</h2>
            <NuxtLink :to="{ path: `/projects/${project.id}`, query: { ...route.query, tab: 'milestones' } }" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">{{ t('projects.overview.viewMilestones') }}</NuxtLink>
          </div>
        </template>
        <USkeleton v-if="milestones.isLoading.value" class="h-10 w-full" />
        <SharedPageState v-else-if="milestones.error.value" :error="milestones.error.value" @retry="milestones.refetch()" />
        <div v-else-if="(milestones.data.value ?? []).length" class="project-summary-milestones grid gap-3">
          <div v-for="item in milestones.data.value" :key="item.id" class="project-summary-milestone flex min-w-0 items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="text-sm font-medium">{{ item.name }}</p>
              <p class="text-xs text-muted">{{ t('projects.milestones.tasksOf', { done: item.done_task_count, total: item.task_count }) }}</p>
            </div>
            <div class="project-summary-milestone-meta flex min-w-0 flex-wrap items-center justify-end gap-2">
              <span class="whitespace-nowrap text-xs text-muted">{{ dateLabel(item.deadline) }}</span>
              <UBadge variant="subtle" :color="STATUS_COLOR[item.is_reached ? 'success' : isOverdue(item.deadline) ? 'destructive' : 'info']">
                {{ t(item.is_reached ? 'projects.milestones.reached' : isOverdue(item.deadline) ? 'projects.milestones.overdue' : 'projects.milestones.upcoming') }}
              </UBadge>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpcomingMilestone') }}</p>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.project-summary-milestones {
  container-type: inline-size;
}

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

@container (max-width: 22rem) {
  .project-summary-milestone {
    align-items: flex-start;
    flex-direction: column;
  }

  .project-summary-milestone-meta {
    justify-content: flex-start;
  }
}
</style>
