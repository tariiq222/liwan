<script setup lang="ts">
import type { LocationQueryRaw } from 'vue-router'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import { projectIdFromPath } from '@/composables/nav/activeRoute'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const projectId = computed(() => projectIdFromPath(route.path))
const { data: projectData, error, refetch } = useProject(projectId)
// Same SSR contract as the frame: reveal the cached project only once hydrated.
const project = computed(() => hydrated.value ? projectData.value : undefined)
const isBoard = computed(() => route.query.view === 'board')
// projectId is non-null on this route: the frame only mounts a child once
// projectIdFromPath has matched.
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value!, route.query))
const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
const canCreate = computed(() => can('pmo.tasks.create') && project.value?.active === true)

// The frame renders the project name as the page's only h1, so this page
// registers the shell title without emitting a competing heading.
usePageHeader(() => t('nav.projectTasks'))

// A link out of this list carries only the filters that decide its order. The
// section path already names where a close returns to, and `view` is this
// page's own presentation choice, not a property of the record being opened.
const filterQuery = computed<LocationQueryRaw>(() => {
  const { view: _view, ...filters } = route.query
  return filters as LocationQueryRaw
})

function onParams(value: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(value) } })
}

function taskTo(taskId: number) {
  return { path: `/projects/${projectId.value}/tasks/${taskId}`, query: filterQuery.value }
}

function viewTo(view: 'list' | 'board') {
  const query: LocationQueryRaw = { ...route.query }
  if (view === 'board') query.view = 'board'
  else delete query.view
  return { path: route.path, query }
}

function openCreate() {
  router.push({ path: `/projects/${projectId.value}/tasks/new`, query: filterQuery.value })
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <section v-else class="min-w-0 space-y-4" :aria-label="t('projects.tabs.tasks')">
      <div v-if="canCreate" class="flex justify-end">
        <UButton
          icon="i-lucide-plus"
          data-testid="project-header-create"
          :disabled="!hydrated"
          :label="t('tasks.new')"
          @click="openCreate"
        />
      </div>
      <TaskToolbar :model-value="params" embedded collapsible hide-project-filter @update:model-value="onParams">
        <template #view>
          <nav class="nasq-ui-segment" :aria-label="t('projects.planning.views')">
            <UButton color="neutral" size="sm" icon="i-lucide-list" :variant="isBoard ? 'ghost' : 'soft'" :to="viewTo('list')" :aria-current="isBoard ? undefined : 'page'">{{ t('projects.tabs.list') }}</UButton>
            <UButton color="neutral" size="sm" icon="i-lucide-layout-grid" :variant="isBoard ? 'soft' : 'ghost'" :to="viewTo('board')" :aria-current="isBoard ? 'page' : undefined">{{ t('projects.tabs.board') }}</UButton>
          </nav>
        </template>
      </TaskToolbar>
      <div class="nasq-ui-record-surface">
        <TaskTable v-if="!isBoard" :params="params" variant="project" embedded @open="(id: number) => router.push(taskTo(id))" @create="openCreate" />
        <TaskBoard v-else :params="params" :stage-source="stageSource" embedded @open="(id: number) => router.push(taskTo(id))" />
      </div>
      <div class="flex justify-end">
        <NuxtLink :to="{ path: '/archived-tasks', query: { project_id: projectId } }" class="text-sm text-muted hover:underline">{{ t('taskLifecycle.archivedTasks') }}</NuxtLink>
      </div>
    </section>
  </SharedPageContainer>
</template>
