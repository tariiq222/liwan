<script setup lang="ts">
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import EmptyState from '@/components/shared/EmptyState.vue'
import { returnToQuery } from '@/utils/safeReturnTo'

const props = defineProps<{ projectId: number; returnTo: string }>()
const taskParams = computed<TaskListParams>(() => ({ mine: false, project_id: props.projectId, closed: false }))
const { data, isLoading, isError, error, refetch } = useTasks(taskParams)
const tasks = computed(() => data.value?.pages.flatMap((page) => page.items) ?? [])
const total = computed(() => data.value?.pages[0]?.total ?? 0)
const capped = computed(() => Math.min(tasks.value.length, 5) < total.value)
const { t } = useI18n()

function taskQuery() {
  return returnToQuery(props.returnTo)
}

</script>

<template>
  <Card data-testid="project-active-tasks" class="nasq-panel overflow-hidden">
    <CardHeader class="flex flex-row items-center justify-between gap-3 pb-3">
      <CardTitle class="text-base">{{ t('projects.overview.activeTasks') }}</CardTitle>
      <NuxtLink :to="{ path: `/projects/${props.projectId}`, query: { tab: 'tasks' } }" class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
        {{ t('projects.tabs.tasks') }}
      </NuxtLink>
    </CardHeader>
    <CardContent>
      <div v-if="isLoading" class="space-y-3" data-testid="project-active-tasks-loading">
        <Skeleton v-for="n in 3" :key="n" class="h-10 w-full" />
      </div>
      <div v-else-if="isError" role="alert" class="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <p class="text-destructive">{{ error instanceof Error ? error.message : t('errors.generic') }}</p>
        <Button type="button" variant="outline" size="sm" @click="refetch()">{{ t('app.retry') }}</Button>
      </div>
      <EmptyState v-else-if="!tasks.length" :title="t('projects.overview.activeTasksEmpty')" />
      <div v-else class="divide-y rounded-lg border">
        <NuxtLink
          v-for="task in tasks.slice(0, 5)"
          :key="task.id"
          :to="{ path: `/projects/${props.projectId}/tasks/${task.id}`, query: taskQuery() }"
          class="block px-3 py-3 hover:bg-muted/50"
        >
          <span class="block truncate text-sm font-medium">{{ task.name }}</span>
          <span class="mt-1 block text-xs text-muted-foreground">{{ task.stage?.name ?? t('tasks.drawer.unassigned') }}</span>
        </NuxtLink>
      </div>
      <p v-if="capped" class="mt-3 text-xs text-muted-foreground">{{ t('projects.overview.activeTasksCap') }}</p>
    </CardContent>
  </Card>
</template>
