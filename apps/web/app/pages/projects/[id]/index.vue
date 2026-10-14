<script setup lang="ts">
import ProjectOverview from '@/components/project/ProjectOverview.vue'
import { formatCalendarDate } from '@/composables/calendarDate'
import { ApiError } from '@/composables/useApi'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { useProject } from '@/composables/useProjects'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, isLoading, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const notFound = computed(() => projectId.value === null || (error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403)))
const projectReturnTo = computed(() => safeReturnTo(route.query.returnTo, '/projects', ['/projects', '/tasks', '/hr', '/settings', '/account', '/search', '/notifications', '/reports']))
// The first client render must match SSR, which has no project yet: loading until hydrated.
const loading = computed(() => !project.value && !error.value && (isLoading.value || !hydrated.value))

function dateLabel(value: string | null | undefined) {
  return value ? formatCalendarDate(value, locale.value) : null
}
</script>

<template>
  <SharedPageContainer v-if="notFound" width="list">
    <div class="flex flex-col items-start gap-3">
      <p class="text-muted">{{ t('projects.notFound') }}</p>
      <UButton type="button" color="neutral" variant="outline" size="sm" @click="router.push(projectReturnTo)">{{ t('projects.backToProjects') }}</UButton>
    </div>
  </SharedPageContainer>
  <!-- The workspace frame above is this page's h1, so hide-header draws no heading here. The title still
       names the page for the shell. The frame and its tabs span the full list width, so the record drops its 68rem
       cap and the summary tiles line up with the tab strip. -->
  <SharedRecordPage v-else hide-header class="!max-w-none" :title="t('nav.projectSummary')" :loading="loading" :error="error" @retry="refetch">
    <ProjectOverview v-if="project" :project="project" />
    <template v-if="project" #aside>
      <SharedPropertiesPanel>
        <SharedPropertyRow v-if="project.date_start" :label="t('projects.charter.fields.date_start')"><bdi>{{ dateLabel(project.date_start) }}</bdi></SharedPropertyRow>
        <SharedPropertyRow v-else :label="t('projects.charter.fields.date_start')" />
        <SharedPropertyRow v-if="project.date_end" :label="t('projects.columns.dateEnd')"><bdi>{{ dateLabel(project.date_end) }}</bdi></SharedPropertyRow>
        <SharedPropertyRow v-else :label="t('projects.columns.dateEnd')" />
        <SharedPropertyRow :label="t('projects.overview.tasks')" :value="t('projects.overview.completedOf', { closed: project.closed_task_count, total: project.task_count })" />
        <SharedPropertyRow :label="t('projects.overview.milestones')" :value="project.milestone_count" />
        <SharedPropertyRow :label="t('projects.overview.followers')" :value="project.followers_count" />
      </SharedPropertiesPanel>
    </template>
  </SharedRecordPage>
</template>
