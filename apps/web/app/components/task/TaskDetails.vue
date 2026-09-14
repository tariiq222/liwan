<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import DependencyPicker from './DependencyPicker.vue'
import TaskActivity from './TaskActivity.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskDescription from './TaskDescription.vue'
import TaskDeliverables from './TaskDeliverables.vue'
import SubtaskList from './SubtaskList.vue'

// Long-form sections of the record (description, activity, resources). The
// field-by-field properties live in TaskProperties, the record's aside.
const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const hydrated = useHydrated()
const tabs = computed(() => [
  { label: t('tasks.drawer.description'), value: 'description', slot: 'description', disabled: !hydrated.value },
  { label: t('tasks.detail.activityTitle'), value: 'activity', slot: 'activity', disabled: !hydrated.value },
  { label: t('tasks.detail.resources'), value: 'resources', slot: 'resources', disabled: !hydrated.value },
])
const completedSubtasks = computed(() => props.task.subtasks.filter(subtask => subtask.is_closed).length)
</script>

<template>
  <UTabs
    data-testid="task-detail-tabs"
    :items="tabs"
    default-value="description"
    :unmount-on-hide="false"
    :aria-label="t('tasks.detail.sections')"
    class="min-w-0"
  >
    <template #description>
      <TaskDescription :key="task.id" :task="task" />
    </template>

    <template #activity>
      <TaskActivity :task="task" />
    </template>

    <template #resources>
      <div class="grid gap-5">
        <TaskDeliverables :key="`outputs-${task.id}`" :task="task" />

        <section class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h2 class="text-base font-semibold text-highlighted">{{ t('tasks.drawer.subtasks') }}</h2>
            <span class="nasq-ui-num text-xs font-normal text-muted">{{ t('tasks.detail.subtaskProgress', { done: completedSubtasks, total: task.subtasks.length }) }}</span>
          </div>
          <SubtaskList :task="task" :base-path="props.basePath" />
        </section>

        <DependencyPicker :task="task" />

        <TaskAttachments :key="task.id" :task-id="task.id" :can-write="task.can_write" />
      </div>
    </template>
  </UTabs>
</template>
