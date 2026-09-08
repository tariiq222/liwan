<script setup lang="ts">
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import { formatCalendarDate } from '@/composables/calendarDate'
import { returnToQuery } from '@/utils/safeReturnTo'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'

const props = defineProps<{ projectId: number; returnTo: string }>()
const taskParams = computed<TaskListParams>(() => ({ mine: false, project_id: props.projectId, closed: false }))
const { data, isLoading, isError, error, refetch } = useTasks(taskParams)
const tasks = computed(() => data.value?.pages.flatMap((page) => page.items) ?? [])
const attention = computed(() => tasks.value.filter(task => task.is_overdue).slice(0, 5))
const { t, locale } = useI18n()
const route = useRoute()

function taskQuery() {
  return returnToQuery(props.returnTo)
}
function deadlineLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <section data-testid="project-active-tasks" class="nasq-panel overflow-hidden">
    <div class="nasq-panel-header">
      <h2>{{ t('projects.overview.needsAttention') }}</h2>
      <NuxtLink :to="{ path: `/projects/${props.projectId}`, query: { ...route.query, tab: 'tasks' } }" class="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
        {{ t('projects.overview.viewTasks') }}
      </NuxtLink>
    </div>
    <div class="nasq-panel-body">
      <div v-if="isLoading" class="space-y-3" data-testid="project-active-tasks-loading">
        <Skeleton v-for="n in 3" :key="n" class="h-10 w-full" />
      </div>
      <div v-else-if="isError" role="alert" class="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p class="text-destructive">{{ error instanceof Error ? error.message : t('errors.generic') }}</p>
        <Button type="button" variant="outline" size="sm" @click="refetch()">{{ t('app.retry') }}</Button>
      </div>
      <template v-else>
        <p v-if="!attention.length" class="text-sm text-muted-foreground">{{ t('projects.refresh.workspace.needsAttentionPreviewEmpty') }}</p>
        <div v-else class="divide-y">
          <NuxtLink
            v-for="task in attention"
            :key="task.id"
            :to="{ path: `/projects/${props.projectId}/tasks/${task.id}`, query: taskQuery() }"
            class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-muted/50"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium">{{ task.name }}</span>
              <span class="mt-1 block text-xs text-muted-foreground">
                {{ task.assignees[0]?.name ?? t('tasks.drawer.unassigned') }}
                · {{ deadlineLabel(task.date_deadline) }}
              </span>
            </span>
            <Badge variant="outline" :class="STATUS_CHIP_CLASS.destructive">{{ t('projects.milestones.overdue') }}</Badge>
          </NuxtLink>
        </div>
        <p class="mt-3 text-xs text-muted-foreground">{{ t('projects.overview.activeTasksCap') }}</p>
      </template>
    </div>
  </section>
</template>
