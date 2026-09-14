<script setup lang="ts">
import type { ProjectDetail } from '@nasq/contracts'
import { getLocalTimeZone, today } from '@internationalized/date'
import { formatCalendarDate, toCalendarDate } from '@/composables/calendarDate'
import { useMilestones } from '@/composables/useMilestones'
import { useProjectUpdates } from '@/composables/useProjectUpdates'
import { sanitizeHtml } from '@/utils/sanitize'
import RecordNumber from '@/components/shared/RecordNumber.vue'
import ProjectOverviewTasks from './ProjectOverviewTasks.vue'
import ProjectStatusBadge from './ProjectStatusBadge.vue'
import ProjectStatusSelect from './ProjectStatusSelect.vue'

// Two-column record (nasq-record-grid): metrics, tasks and the latest update
// in the main column; the project's properties and milestones in the aside.
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
function milestoneTone(item: { is_reached: boolean; deadline: string | null }) {
  return item.is_reached ? 'done' : isOverdue(item.deadline) ? 'overdue' : 'in_progress'
}
</script>

<template>
  <div data-testid="project-overview" class="nasq-record-grid">
    <div class="nasq-record-main">
      <section class="grid gap-3 sm:grid-cols-3" :aria-label="t('projects.overview.progress')">
        <div class="nasq-ui-record-surface p-4">
          <div class="nasq-ui-label flex items-center gap-2"><UIcon name="i-lucide-list-checks" class="size-4" />{{ t('projects.overview.progress') }}</div>
          <p class="nasq-ui-num mt-2 text-2xl font-semibold leading-none">{{ project.progress }}%</p>
          <UProgress :model-value="project.progress" :style="{ '--nasq-ui-progress': `${Math.min(100, Math.max(0, project.progress))}%` }" class="nasq-ui-progress mt-3" size="sm" />
          <p class="nasq-ui-num mt-2 text-xs text-muted">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
        </div>
        <div class="nasq-ui-record-surface p-4">
          <div class="nasq-ui-label flex items-center gap-2"><UIcon name="i-lucide-list-checks" class="size-4" />{{ t('projects.overview.openTasks') }}</div>
          <p class="nasq-ui-num mt-2 text-2xl font-semibold leading-none">{{ openTaskCount }}</p>
          <p class="nasq-ui-num mt-2 text-xs text-muted">{{ t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count }) }}</p>
        </div>
        <div class="nasq-ui-record-surface p-4">
          <div class="nasq-ui-label flex items-center gap-2"><UIcon name="i-lucide-flag" class="size-4" />{{ t('projects.overview.nextMilestone') }}</div>
          <p class="nasq-ui-num mt-2 text-2xl font-semibold leading-none">{{ nearestMilestone ? dateLabel(nearestMilestone.deadline) : '—' }}</p>
          <p class="mt-2 truncate text-xs text-muted">{{ nearestMilestone?.name ?? t('projects.overview.noUpcomingMilestone') }}</p>
        </div>
      </section>

      <ProjectOverviewTasks :project-id="project.id" :return-to="route.fullPath" />

      <UCard>
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-base font-semibold text-highlighted">{{ t('projects.overview.latestUpdate') }}</h2>
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
          <p class="mt-1 text-xs text-muted">{{ latestUpdate.author.name }} · <span class="nasq-ui-num">{{ dateLabel(latestUpdate.date) }}</span></p>
          <div class="prose prose-sm mt-2 max-w-none break-words text-sm" v-html="previewHtml(latestUpdate.description_html)" />
        </template>
        <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpdates') }}</p>
      </UCard>
    </div>

    <aside class="nasq-record-aside" :aria-label="t('projects.overview.deliveryMilestones')">
      <dl class="nasq-record-props">
        <div class="nasq-record-prop">
          <dt class="nasq-ui-label">{{ t('projects.columns.status') }}</dt>
          <dd>
            <ProjectStatusSelect v-if="project.can_manage" :project="project" />
            <ProjectStatusBadge v-else :status="project.status" />
          </dd>
        </div>
        <div class="nasq-record-prop">
          <dt class="nasq-ui-label">{{ t('projects.columns.dateEnd') }}</dt>
          <dd class="nasq-ui-num">
            <template v-if="project.date_start || project.date_end">{{ dateLabel(project.date_start) }} — {{ dateLabel(project.date_end) }}</template>
            <span v-else class="text-muted">{{ t('projects.overview.noDates') }}</span>
          </dd>
        </div>
        <div class="nasq-record-prop">
          <dt class="nasq-ui-label">{{ t('app.recordNumber') }}</dt>
          <dd><RecordNumber :value="project.id" /></dd>
        </div>
        <div class="nasq-record-prop">
          <dt class="nasq-ui-label">{{ t('nav.meetings') }}</dt>
          <dd>
            <NuxtLink :to="{ path: '/meetings', query: { project_id: String(project.id), returnTo: route.fullPath } }" class="text-brand-link underline underline-offset-4">
              {{ t('nav.meetings') }}
            </NuxtLink>
          </dd>
        </div>
      </dl>

      <section class="mt-5 border-t border-default pt-4" data-testid="project-overview-milestones">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-highlighted"><UIcon name="i-lucide-calendar-clock" class="size-4" />{{ t('projects.overview.deliveryMilestones') }}</h2>
          <NuxtLink :to="{ path: `/projects/${project.id}/milestones`, query: { returnTo: route.fullPath } }" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">{{ t('projects.overview.viewMilestones') }}</NuxtLink>
        </div>
        <USkeleton v-if="milestones.isLoading.value" class="h-10 w-full" />
        <SharedPageState v-else-if="milestones.error.value" :error="milestones.error.value" @retry="milestones.refetch()" />
        <ul v-else-if="(milestones.data.value ?? []).length" class="grid gap-3">
          <li v-for="item in milestones.data.value" :key="item.id" class="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ item.name }}</p>
              <p class="nasq-ui-num text-xs text-muted">{{ t('projects.milestones.tasksOf', { done: item.done_task_count, total: item.task_count }) }} · {{ dateLabel(item.deadline) }}</p>
            </div>
            <span class="nasq-ui-status-pill" :data-tone="milestoneTone(item)">
              {{ t(item.is_reached ? 'projects.milestones.reached' : isOverdue(item.deadline) ? 'projects.milestones.overdue' : 'projects.milestones.upcoming') }}
            </span>
          </li>
        </ul>
        <p v-else class="text-sm text-muted">{{ t('projects.overview.noUpcomingMilestone') }}</p>
      </section>
    </aside>
  </div>
</template>
