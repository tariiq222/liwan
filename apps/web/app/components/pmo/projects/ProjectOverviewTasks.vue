<script setup lang="ts">
import { useTasks, type TaskListParams } from '@/composables/useTasks'
import { formatCalendarDate } from '@nasq/ui/app/composables/calendarDate'
import { returnToQuery } from '@/utils/safeReturnTo'

// "Needs your attention": the overdue open tasks of the project (first five), as a record section.
const props = defineProps<{ projectId: number; returnTo: string }>()
const taskParams = computed<TaskListParams>(() => ({ mine: false, project_id: props.projectId, closed: false }))
const { data, isLoading, isError, error, refetch } = useTasks(taskParams)
const tasks = computed(() => data.value?.pages.flatMap(page => page.items) ?? [])
const attention = computed(() => tasks.value.filter(task => task.is_overdue).slice(0, 5))
const { t, locale } = useI18n()

function taskQuery() {
  return returnToQuery(props.returnTo)
}
function deadlineLabel(value: string | null) {
  return value ? formatCalendarDate(value, locale.value) : '—'
}
</script>

<template>
  <SharedRecordSection panel data-testid="project-active-tasks" :title="t('projects.overview.needsAttention')">
    <template #actions>
      <NuxtLink :to="`/projects/${props.projectId}/tasks`" class="text-xs text-muted underline underline-offset-4 hover:text-highlighted">
        {{ t('projects.overview.viewTasks') }}
      </NuxtLink>
    </template>
    <div>
      <div v-if="isLoading" class="space-y-3" data-testid="project-active-tasks-loading">
        <SharedLoadingSkeleton :count="3" />
      </div>
      <UAlert v-else-if="isError" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error instanceof Error ? error.message : t('errors.generic')">
        <template #actions>
          <UButton type="button" color="neutral" variant="outline" size="sm" :label="t('app.retry')" @click="refetch()" />
        </template>
      </UAlert>
      <template v-else>
        <p v-if="!attention.length" class="text-sm text-muted">{{ t('projects.refresh.workspace.needsAttentionPreviewEmpty') }}</p>
        <div v-else class="divide-y divide-default">
          <NuxtLink
            v-for="task in attention"
            :key="task.id"
            :to="{ path: `/projects/${props.projectId}/tasks/${task.id}`, query: taskQuery() }"
            class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 hover:bg-elevated/50"
          >
            <span class="min-w-0">
              <span class="block truncate text-sm font-medium">{{ task.name }}</span>
              <span class="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                <span>{{ task.assignees[0]?.name ?? t('tasks.drawer.unassigned') }}</span>
                <span aria-hidden="true">·</span>
                <bdi>{{ deadlineLabel(task.date_deadline) }}</bdi>
              </span>
            </span>
            <UBadge variant="subtle" color="error">{{ t('projects.milestones.overdue') }}</UBadge>
          </NuxtLink>
        </div>
        <p class="mt-3 text-xs text-muted">{{ t('projects.overview.activeTasksCap') }}</p>
      </template>
    </div>
  </SharedRecordSection>
</template>
