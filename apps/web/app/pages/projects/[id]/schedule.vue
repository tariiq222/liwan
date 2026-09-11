<script setup lang="ts">
import { inject } from 'vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import ScheduleGantt from '@/components/project/schedule/ScheduleGantt.vue'
import type { ScheduleScale } from '@/utils/projectSchedule'
import { returnToQuery } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const isProjectOverlay = inject<boolean>(Symbol.for('nasq.project.overlay'), false)
const projectId = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const isBaseRoute = computed(() => route.path.replace(/\/+$/, '') === `/projects/${route.params.id}/schedule`)
const { data: projectData, error: projectError, refetch: refetchProject } = useProject(projectId)
const project = computed(() => hydrated.value ? projectData.value : undefined)
const { data: schedule, isLoading, error, refetch } = useProjectSchedule(projectId)
const scale = computed<ScheduleScale>({
  get: () => route.query.scale === 'month' ? 'month' : 'week',
  set: value => { void router.replace({ query: { ...route.query, scale: value } }) },
})
const notFound = computed(() => projectId.value === null || (projectError.value instanceof ApiError && [403, 404].includes(projectError.value.status)))
function retry() { void Promise.all([refetchProject(), refetch()]) }

function openTaskCreate() {
  if (!projectId.value) return
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: { ...route.query, ...returnToQuery(route.fullPath), tab: 'tasks' } })
}
function openSettings() {
  if (!projectId.value) return
  router.push({ path: `/projects/${projectId.value}/settings`, query: returnToQuery(route.fullPath) })
}
function onArchived() {
  router.push('/projects')
}
</script>

<template>
  <SharedPageContainer v-if="isBaseRoute" width="list">
    <ProjectHeader
      v-if="project && !isProjectOverlay"
      :project="project"
      :title="t('projects.schedule.title')"
      :can-create="can('pmo.tasks.create')"
      :create-label="t('tasks.new')"
      @create="openTaskCreate"
      @settings="openSettings"
      @archived="onArchived"
    />
    <SharedPageHeader
      v-else-if="!isProjectOverlay"
      :title="t('projects.schedule.title')"
    />
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex rounded-lg border p-0.5" role="group" :aria-label="t('projects.schedule.scale')">
        <UButton type="button" size="sm" class="rounded-md" :variant="scale === 'week' ? 'solid' : 'ghost'" :disabled="!hydrated" :aria-pressed="scale === 'week'" @click="scale = 'week'">{{ t('projects.schedule.week') }}</UButton>
        <UButton type="button" size="sm" class="rounded-md" :variant="scale === 'month' ? 'solid' : 'ghost'" :disabled="!hydrated" :aria-pressed="scale === 'month'" @click="scale = 'month'">{{ t('projects.schedule.month') }}</UButton>
      </div>
    </div>
    <SharedPageState
      :loading="isLoading && !schedule"
      :error="projectError || error"
      :empty="projectId === null || notFound || (!isLoading && !schedule && !error)"
      :empty-text="projectId === null || notFound ? t('projects.notFound') : t('projects.schedule.empty')"
      @retry="retry"
    >
      <ScheduleGantt v-if="schedule" embedded :schedule="schedule" :scale="scale" :project-start="project?.date_start" :project-end="project?.date_end" @update:scale="scale = $event" />
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage />
</template>
