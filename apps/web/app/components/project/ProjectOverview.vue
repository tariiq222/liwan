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
import ProjectProgress from './ProjectProgress.vue'

const props = defineProps<{ project: ProjectDetail }>()
const { t, locale } = useI18n()
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
  <Card data-testid="project-overview" class="nasq-panel">
    <CardHeader class="space-y-1">
      <CardTitle class="text-base">{{ t('projects.overview.title') }}</CardTitle>
      <CardDescription>{{ t('projects.description') }}</CardDescription>
    </CardHeader>
    <CardContent class="space-y-5">
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border bg-muted/20 p-4">
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground"><CircleDot class="size-4" />{{ t('projects.setStatus') }}</div>
          <ProjectStatusBadge class="mt-3" :status="project.status" />
        </div>
        <div class="rounded-lg border bg-muted/20 p-4">
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground"><ListChecks class="size-4" />{{ t('projects.overview.progress') }}</div>
          <ProjectProgress class="mt-3" :progress="project.progress" :task-count="project.task_count" :closed-task-count="project.closed_task_count" compact />
        </div>
        <div class="rounded-lg border bg-muted/20 p-4">
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground"><ListChecks class="size-4" />{{ t('projects.overview.openTasks') }}</div>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ openTaskCount }}</p>
          <p class="text-xs text-muted-foreground">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
        </div>
        <div class="rounded-lg border bg-muted/20 p-4">
          <div class="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Flag class="size-4" />{{ t('projects.overview.milestones') }}</div>
          <p class="mt-2 text-2xl font-semibold tabular-nums">{{ project.milestone_count }}</p>
          <NuxtLink :to="{ path: `/projects/${project.id}`, query: { tab: 'milestones' } }" class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">{{ t('projects.tabs.milestones') }}</NuxtLink>
        </div>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="rounded-lg border p-4">
          <p class="mb-2 text-xs font-medium text-muted-foreground">{{ t('projects.settings.description') }}</p>
        <div v-if="project.description_html" class="prose prose-sm max-w-none break-words text-sm" v-html="sanitizeHtml(project.description_html)" />
        <p v-else class="text-sm text-muted-foreground">{{ t('projects.overview.noDescription') }}</p>
        <p class="mt-3 text-xs font-medium text-muted-foreground">{{ t('projects.overview.completedSummary', { closed: project.closed_task_count, total: project.task_count }) }}</p>
        </div>

        <div class="rounded-lg border p-4">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-medium"><CalendarClock class="size-[18px] text-muted-foreground" />{{ t('projects.overview.nextMilestone') }}</div>
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              <NuxtLink :to="{ path: `/projects/${project.id}`, query: { tab: 'milestones' } }" class="underline underline-offset-4 hover:text-foreground">{{ t('projects.tabs.milestones') }}</NuxtLink>
              <NuxtLink :to="`/projects/${project.id}/schedule`" class="underline underline-offset-4 hover:text-foreground">{{ t('projects.planningLinks.schedule') }}</NuxtLink>
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
        </div>
        <div class="rounded-lg border p-4 sm:col-span-2">
          <div class="mb-3 flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 text-sm font-medium"><MessageSquareText class="size-[18px] text-muted-foreground" />{{ t('projects.overview.latestUpdate') }}</div>
            <NuxtLink :to="{ path: `/projects/${project.id}`, query: { tab: 'updates' } }" class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">{{ t('projects.tabs.updates') }}</NuxtLink>
          </div>
          <Skeleton v-if="updates.isLoading.value" class="h-10 w-full" />
          <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
          <template v-else-if="latestUpdate">
            <div class="flex items-center gap-2"><ProjectStatusBadge :status="latestUpdate.status" /><span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span></div>
            <p class="mt-1 text-xs text-muted-foreground">{{ latestUpdate.author.name }} · {{ dateLabel(latestUpdate.date) }}</p>
            <div class="prose prose-sm mt-2 max-w-none break-words text-sm" v-html="sanitizeHtml(latestUpdate.description_html)" />
          </template>
          <p v-else class="text-sm text-muted-foreground">{{ t('projects.overview.noUpdates') }}</p>
        </div>
    </CardContent>
  </Card>
</template>
