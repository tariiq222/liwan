<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { CalendarClock, CheckCircle2, CircleDot, Flag, ListChecks, MessageSquareText } from '@lucide/vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'
import { sanitizeHtml } from '@/utils/sanitize'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'
import ProjectProgress from './ProjectProgress.vue'

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

function dateLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
function isOverdue(value: string | null) {
  const deadline = toCalendarDate(value)
  return deadline ? deadline.compare(today(getLocalTimeZone())) < 0 : false
}
</script>

<template>
  <div data-testid="project-overview" class="grid gap-5">
    <section class="nasq-metrics">
      <article class="nasq-metric">
        <div class="nasq-metric-title"><CircleDot class="size-4" />{{ t('projects.setStatus') }}</div>
        <ProjectStatusSelect v-if="project.can_manage" class="mt-3" :project="project" />
        <ProjectStatusBadge v-else class="mt-3" :status="project.status" />
      </article>
      <article class="nasq-metric">
        <div class="nasq-metric-title"><ListChecks class="size-4" />{{ t('projects.overview.progress') }}</div>
        <ProjectProgress class="mt-3" :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" compact />
      </article>
      <article class="nasq-metric">
        <div class="nasq-metric-title"><ListChecks class="size-4" />{{ t('projects.overview.openTasks') }}</div>
        <p class="nasq-metric-value tabular-nums">{{ openTaskCount }}</p>
        <p class="nasq-metric-foot">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
      </article>
      <article class="nasq-metric">
        <div class="nasq-metric-title"><Flag class="size-4" />{{ t('projects.overview.milestones') }}</div>
        <p class="nasq-metric-value tabular-nums">{{ project.milestone_count }}</p>
        <NuxtLink :to="{ path: `/projects/${project.id}`, query: { ...route.query, tab: 'milestones' } }" class="nasq-metric-foot underline underline-offset-4 hover:text-foreground">{{ t('projects.tabs.milestones') }}</NuxtLink>
      </article>
    </section>

    <div class="grid gap-4 sm:grid-cols-2">
      <section class="nasq-panel nasq-panel-body">
          <p class="mb-2 text-xs font-medium text-muted-foreground">{{ t('projects.settings.description') }}</p>
        <div v-if="project.description_html" class="prose prose-sm max-w-none break-words text-sm" v-html="previewHtml(project.description_html)" />
        <p v-else class="text-sm text-muted-foreground">{{ t('projects.overview.noDescription') }}</p>
        <p class="mt-3 text-xs font-medium text-muted-foreground">{{ t('projects.overview.completedSummary', { closed: project.closed_task_count, total: project.task_count }) }}</p>
      </section>

      <section class="nasq-panel nasq-panel-body">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-medium"><CalendarClock class="size-[18px] text-muted-foreground" />{{ t('projects.overview.nextMilestone') }}</div>
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              <NuxtLink :to="{ path: `/projects/${project.id}`, query: { ...route.query, tab: 'milestones' } }" class="underline underline-offset-4 hover:text-foreground">{{ t('projects.tabs.milestones') }}</NuxtLink>
              <NuxtLink :to="{ path: `/projects/${project.id}/schedule`, query: route.query }" class="underline underline-offset-4 hover:text-foreground">{{ t('projects.planningLinks.schedule') }}</NuxtLink>
            </div>
          </div>
          <Skeleton v-if="milestones.isLoading.value" class="h-10 w-full" />
          <SharedPageState v-else-if="milestones.error.value" :error="milestones.error.value" @retry="milestones.refetch()" />
          <template v-else-if="nearestMilestone">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="text-sm font-medium">{{ nearestMilestone.name }}</p>
              <Badge variant="outline" :class="STATUS_CHIP_CLASS[isOverdue(nearestMilestone.deadline) ? 'destructive' : 'info']">{{ t(isOverdue(nearestMilestone.deadline) ? 'projects.milestones.overdue' : 'projects.milestones.upcoming') }}</Badge>
            </div>
            <p class="mt-1 text-xs text-muted-foreground">{{ dateLabel(nearestMilestone.deadline) }} · {{ t('projects.milestones.tasksOf', { done: nearestMilestone.done_task_count, total: nearestMilestone.task_count }) }}</p>
          </template>
          <p v-else class="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 class="size-4" />{{ t('projects.overview.noUpcomingMilestone') }}</p>
      </section>
        <section class="nasq-panel nasq-panel-body sm:col-span-2">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-medium"><MessageSquareText class="size-[18px] text-muted-foreground" />{{ t('projects.overview.latestUpdate') }}</div>
            <NuxtLink :to="{ path: `/projects/${project.id}`, query: { ...route.query, tab: 'updates' } }" class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">{{ t('projects.tabs.updates') }}</NuxtLink>
          </div>
          <Skeleton v-if="updates.isLoading.value" class="h-10 w-full" />
          <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
          <template v-else-if="latestUpdate">
            <div class="flex items-center gap-2"><ProjectStatusBadge :status="latestUpdate.status" /><span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span></div>
            <p class="mt-1 text-xs text-muted-foreground">{{ latestUpdate.author.name }} · {{ dateLabel(latestUpdate.date) }}</p>
            <div class="prose prose-sm mt-2 max-w-none break-words text-sm" v-html="previewHtml(latestUpdate.description_html)" />
          </template>
          <p v-else class="text-sm text-muted-foreground">{{ t('projects.overview.noUpdates') }}</p>
        </section>
      </div>
  </div>
</template>
