<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { CalendarClock, Flag, ListChecks } from '@lucide/vue'
import { getLocalTimeZone, today } from '@internationalized/date'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'
import { sanitizeHtml } from '@/utils/sanitize'
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
  <div data-testid="project-overview" class="grid gap-6">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <ProjectStatusSelect v-if="project.can_manage" :project="project" />
      <ProjectStatusBadge v-else :status="project.status" />
      <span class="text-muted-foreground">{{ dateRange }}</span>
      <p class="font-mono text-xs text-muted-foreground" dir="ltr">{{ t('projects.projectId', { id: project.id }) }}</p>
    </div>

    <section class="nasq-metrics" data-cols="3">
      <article class="nasq-metric">
        <div class="nasq-metric-title"><ListChecks class="size-4" />{{ t('projects.overview.progress') }}</div>
        <p class="nasq-metric-value tabular-nums">{{ project.progress }}%</p>
        <p class="nasq-metric-foot">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
      </article>
      <article class="nasq-metric">
        <div class="nasq-metric-title"><ListChecks class="size-4" />{{ t('projects.overview.openTasks') }}</div>
        <p class="nasq-metric-value tabular-nums">{{ openTaskCount }}</p>
        <p class="nasq-metric-foot">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
      </article>
      <article class="nasq-metric">
        <div class="nasq-metric-title"><Flag class="size-4" />{{ t('projects.overview.nextMilestone') }}</div>
        <p class="nasq-metric-value">{{ nearestMilestone ? dateLabel(nearestMilestone.deadline) : '—' }}</p>
        <p class="nasq-metric-foot">{{ nearestMilestone?.name ?? t('projects.overview.noUpcomingMilestone') }}</p>
      </article>
    </section>

    <div class="nasq-detail-grid">
      <div class="grid gap-4">
        <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />
        <section class="nasq-panel overflow-hidden">
          <div class="nasq-panel-header">
            <h2>{{ t('projects.overview.latestUpdate') }}</h2>
          </div>
          <div class="nasq-panel-body">
            <Skeleton v-if="updates.isLoading.value" class="h-10 w-full" />
            <SharedPageState v-else-if="updates.error.value" :error="updates.error.value" @retry="updates.refetch()" />
            <template v-else-if="latestUpdate">
              <div class="flex items-center gap-2"><ProjectStatusBadge :status="latestUpdate.status" /><span class="truncate text-sm font-medium">{{ latestUpdate.name }}</span></div>
              <p class="mt-1 text-xs text-muted-foreground">{{ latestUpdate.author.name }} · {{ dateLabel(latestUpdate.date) }}</p>
              <div class="prose prose-sm mt-2 max-w-none break-words text-sm" v-html="previewHtml(latestUpdate.description_html)" />
            </template>
            <p v-else class="text-sm text-muted-foreground">{{ t('projects.overview.noUpdates') }}</p>
          </div>
        </section>
      </div>
      <section class="nasq-panel overflow-hidden">
        <div class="nasq-panel-header">
          <h2 class="flex items-center gap-2"><CalendarClock class="size-4" />{{ t('projects.overview.deliveryMilestones') }}</h2>
          <NuxtLink :to="{ path: `/projects/${project.id}`, query: { ...route.query, tab: 'milestones' } }" class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">{{ t('projects.overview.viewMilestones') }}</NuxtLink>
        </div>
        <div class="nasq-panel-body">
          <Skeleton v-if="milestones.isLoading.value" class="h-10 w-full" />
          <SharedPageState v-else-if="milestones.error.value" :error="milestones.error.value" @retry="milestones.refetch()" />
          <div v-else-if="(milestones.data.value ?? []).length" class="grid gap-3">
            <div v-for="item in milestones.data.value" :key="item.id" class="flex flex-wrap items-center justify-between gap-2">
              <div class="min-w-0">
                <p class="text-sm font-medium">{{ item.name }}</p>
                <p class="text-xs text-muted-foreground">{{ t('projects.milestones.tasksOf', { done: item.done_task_count, total: item.task_count }) }}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground">{{ dateLabel(item.deadline) }}</span>
                <Badge variant="outline" :class="STATUS_CHIP_CLASS[item.is_reached ? 'success' : isOverdue(item.deadline) ? 'destructive' : 'info']">
                  {{ t(item.is_reached ? 'projects.milestones.reached' : isOverdue(item.deadline) ? 'projects.milestones.overdue' : 'projects.milestones.upcoming') }}
                </Badge>
              </div>
            </div>
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('projects.overview.noUpcomingMilestone') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>
