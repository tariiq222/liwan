<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useProject } from '@/composables/useProjects'
import { useProjectSchedule } from '@/composables/useProjectSchedule'
import ScheduleGantt from '@/components/project/schedule/ScheduleGantt.vue'
import type { ScheduleScale } from '@/utils/projectSchedule'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const projectId = computed(() => { const value = Number(route.params.id); return Number.isInteger(value) && value > 0 ? value : null })
const isBaseRoute = computed(() => route.path.replace(/\/+$/, '') === `/projects/${route.params.id}/schedule`)
const { data: project } = useProject(projectId)
const { data: schedule, isLoading, error } = useProjectSchedule(projectId)
const scale = computed<ScheduleScale>({
  get: () => route.query.scale === 'month' ? 'month' : 'week',
  set: value => { void router.replace({ query: { ...route.query, scale: value } }) },
})
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && [403, 404].includes(error.value.status)))
const returnTo = computed(() => projectId.value ? safeReturnTo(route.query.returnTo, `/projects/${projectId.value}`, ['/projects']) : '/projects')
</script>

<template>
  <section v-if="isBaseRoute" class="nasq-page-stack mx-auto w-full max-w-7xl">
    <SharedPageHeader :title="t('projects.schedule.title')" :description="project?.name" :back-to="returnTo" :back-label="t('projects.backToProject')" />
    <p v-if="projectId === null || notFound" class="text-muted-foreground">{{ t('projects.notFound') }}</p>
    <p v-else-if="isLoading && !schedule" role="status" class="text-muted-foreground">{{ t('projects.loading') }}</p>
    <p v-else-if="error || !schedule" role="alert" class="text-destructive">{{ t('projects.loadError') }}</p>
    <ScheduleGantt v-else :schedule="schedule" :scale="scale" @update:scale="scale = $event" />
  </section>
  <NuxtPage />
</template>
