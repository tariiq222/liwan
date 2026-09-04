<script setup lang="ts">
import CreateTaskDialog from '@/components/task/CreateTaskDialog.vue'
import TaskBoard from '@/components/task/TaskBoard.vue'
import TaskTable from '@/components/task/TaskTable.vue'
import TaskToolbar from '@/components/task/TaskToolbar.vue'
import ProjectHeader from '@/components/project/ProjectHeader.vue'
import { ApiError } from '@/composables/useApi'
import { projectTaskParams, projectTaskQuery } from '@/composables/projectTaskParams'
import { useProject } from '@/composables/useProjects'
import type { TaskListParams } from '@/composables/useTasks'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()

const projectId = computed(() => Number(route.params.id))
const { data: project, isLoading, error } = useProject(projectId)
// 404 (missing) and 403 (exists, unreadable) both mean "not yours to see".
const notFound = computed(() => error.value instanceof ApiError && (error.value.status === 404 || error.value.status === 403))

const tab = computed(() => (route.query.tab === 'board' ? 'board' : 'list'))
function onTabChange(v: unknown) {
  router.replace({ query: { ...route.query, tab: v === 'board' ? 'board' : undefined } })
}

// Filters live in the URL (see projectTaskParams.ts) so the nested task modal
// and this page query the same cache key and closing the modal restores them.
const params = computed<TaskListParams>(() => projectTaskParams(projectId.value, route.query))
function onParams(p: TaskListParams) {
  router.replace({ query: { ...route.query, ...projectTaskQuery(p) } })
}

function openTask(taskId: number) {
  router.push({ path: `/projects/${projectId.value}/tasks/${taskId}`, query: route.query })
}

const createOpen = ref(false)
const stageSource = computed(() => ({ kind: 'project' as const, stages: project.value?.stages ?? [] }))
</script>

<template>
  <div class="space-y-4">
    <div v-if="notFound" class="flex flex-col items-start gap-3">
      <p class="text-muted-foreground">{{ t('projects.notFound') }}</p>
      <NuxtLink to="/projects" class="text-sm underline">{{ t('projects.backToProjects') }}</NuxtLink>
    </div>

    <template v-else>
      <ProjectHeader v-if="project" :project="project" @create="createOpen = true" />
      <Skeleton v-else-if="isLoading" class="h-9 w-1/2" />

      <Tabs :model-value="tab" @update:model-value="onTabChange">
        <TabsList>
          <TabsTrigger value="list" :disabled="!hydrated">{{ t('projects.tabs.list') }}</TabsTrigger>
          <TabsTrigger value="board" :disabled="!hydrated">{{ t('projects.tabs.board') }}</TabsTrigger>
        </TabsList>
        <TabsContent value="list" class="space-y-4">
          <TaskToolbar :model-value="params" hide-project-filter @update:model-value="onParams" @create="createOpen = true" />
          <TaskTable :params="params" variant="project" @open="openTask" @create="createOpen = true" />
        </TabsContent>
        <TabsContent value="board" class="space-y-4">
          <TaskToolbar :model-value="params" hide-project-filter @update:model-value="onParams" @create="createOpen = true" />
          <TaskBoard v-if="project" :params="params" :stage-source="stageSource" @open="openTask" />
        </TabsContent>
      </Tabs>

      <CreateTaskDialog v-model:open="createOpen" :project-id="projectId" @created="openTask" />
      <NuxtPage />
    </template>
  </div>
</template>
