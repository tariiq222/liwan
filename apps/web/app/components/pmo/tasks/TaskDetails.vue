<script setup lang="ts">
import type { TaskDetail } from '@liwan/contracts'
import { sectionTabsUi } from '@liwan/ui/app/utils/sectionTabs'
import DependencyPicker from './DependencyPicker.vue'
import TaskActivity from './TaskActivity.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskDescription from './TaskDescription.vue'
import TaskDeliverables from './TaskDeliverables.vue'
import SubtaskList from './SubtaskList.vue'

// Three stacked cards in the record's main column: what the task is (description and deliverables),
// its work sections, and its activity. A host that has more work sections (the project workspace's
// schedule) passes them through the `schedule` slot, which becomes one more work tab.
const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const hydrated = useHydrated()
const slots = useSlots()
const workTabs = computed(() => [
  { label: t('tasks.drawer.subtasks'), value: 'subtasks', slot: 'subtasks', disabled: !hydrated.value },
  { label: t('taskLifecycle.dependencies'), value: 'dependencies', slot: 'dependencies', disabled: !hydrated.value },
  { label: t('tasks.drawer.attachments'), value: 'attachments', slot: 'attachments', disabled: !hydrated.value },
  ...(slots.schedule ? [{ label: t('projects.schedule.title'), value: 'schedule', slot: 'schedule', disabled: !hydrated.value }] : []),
])
const activityTabs = computed(() => [
  { label: t('tasks.detail.commentsTitle'), value: 'comments', slot: 'comments', disabled: !hydrated.value },
  { label: t('tasks.detail.logTitle'), value: 'log', slot: 'log', disabled: !hydrated.value },
])
const completedSubtasks = computed(() => props.task.subtasks.filter(subtask => subtask.is_closed).length)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('tasks.drawer.description')">
    <TaskDescription :key="task.id" :task="task" />
    <TaskDeliverables :key="`outputs-${task.id}`" :task="task" class="mt-4 block border-t border-default pt-4" />
  </SharedRecordSection>

  <SharedRecordSection variant="panel">
    <UTabs
      data-testid="task-detail-tabs"
      variant="link"
      :ui="sectionTabsUi"
      :items="workTabs"
      default-value="subtasks"
      :unmount-on-hide="false"
      :aria-label="t('tasks.detail.sections')"
      class="min-w-0"
    >
      <template #subtasks>
        <section class="space-y-3">
          <p class="text-xs text-muted">{{ t('tasks.detail.subtaskProgress', { done: completedSubtasks, total: task.subtasks.length }) }}</p>
          <SubtaskList :task="task" :base-path="props.basePath" />
        </section>
      </template>

      <template #dependencies>
        <DependencyPicker :task="task" />
      </template>

      <template #attachments>
        <TaskAttachments :key="task.id" :task-id="task.id" :can-write="task.can_write" />
      </template>

      <template v-if="$slots.schedule" #schedule>
        <slot name="schedule" :task="task" />
      </template>
    </UTabs>
  </SharedRecordSection>

  <SharedRecordSection variant="panel">
    <UTabs
      data-testid="task-activity-tabs"
      variant="link"
      :ui="sectionTabsUi"
      :items="activityTabs"
      default-value="comments"
      :unmount-on-hide="false"
      :aria-label="t('tasks.drawer.activity')"
      class="min-w-0"
    >
      <template #comments>
        <TaskActivity :task="task" mode="comments" />
      </template>

      <template #log>
        <TaskActivity :task="task" mode="log" />
      </template>
    </UTabs>
  </SharedRecordSection>
</template>
