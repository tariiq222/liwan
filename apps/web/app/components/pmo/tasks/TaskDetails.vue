<script setup lang="ts">
import type { TaskDetail } from '@liwan/contracts'
import { formatLiwanDateTime } from '@liwan/ui/app/composables/calendarDate'
import { sectionTabsUi } from '@liwan/ui/app/utils/sectionTabs'
import DependencyPicker from './DependencyPicker.vue'
import TaskActivity from './TaskActivity.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskDescription from './TaskDescription.vue'
import TaskDeliverables from './TaskDeliverables.vue'
import SubtaskList from './SubtaskList.vue'

const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const hydrated = useHydrated()
const tabs = computed(() => [
  { label: t('tasks.drawer.details'), value: 'details', slot: 'details', disabled: !hydrated.value },
  { label: t('tasks.detail.commentsTitle'), value: 'comments', slot: 'comments', disabled: !hydrated.value },
  { label: t('tasks.detail.logTitle'), value: 'log', slot: 'log', disabled: !hydrated.value },
  { label: t('tasks.drawer.subtasks'), value: 'subtasks', slot: 'subtasks', disabled: !hydrated.value },
  { label: t('tasks.drawer.attachments'), value: 'attachments', slot: 'attachments', disabled: !hydrated.value },
  { label: t('taskLifecycle.dependencies'), value: 'dependencies', slot: 'dependencies', disabled: !hydrated.value },
])
// The details tab stacks its sections as rows: title in the start column, content beside it.
const rowClass = 'grid gap-x-8 gap-y-4 py-6 first:pt-2 last:pb-0 lg:grid-cols-[11rem_minmax(0,1fr)]'
const rowTitleClass = 'text-sm font-semibold text-highlighted'
const dateTimeFmt = computed(() => ({ format: (value: Date) => formatLiwanDateTime(value) }))

// --- metrics ---------------------------------------------------------------
const createdLabel = computed(() => dateTimeFmt.value.format(new Date(props.task.created_at)))
const updatedLabel = computed(() => dateTimeFmt.value.format(new Date(props.task.updated_at)))
const completedSubtasks = computed(() => props.task.subtasks.filter(subtask => subtask.is_closed).length)
</script>

<template>
  <UTabs
    data-testid="task-detail-tabs"
    variant="link"
    :ui="sectionTabsUi"
    :items="tabs"
    default-value="details"
    :unmount-on-hide="false"
    :aria-label="t('tasks.detail.sections')"
    class="min-w-0"
  >
    <template #details>
      <div class="divide-y divide-default">
        <section :class="rowClass" aria-labelledby="task-description-title">
          <h2 id="task-description-title" :class="rowTitleClass">{{ t('tasks.drawer.description') }}</h2>
          <TaskDescription :key="task.id" :task="task" />
        </section>

        <TaskDeliverables :key="`outputs-${task.id}`" :task="task" :class="rowClass" />

        <section :class="rowClass" aria-labelledby="task-section-metrics">
          <h2 id="task-section-metrics" :class="rowTitleClass">{{ t('tasks.drawer.metrics') }}</h2>
          <dl class="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.created') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ createdLabel }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.updated') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ updatedLabel }}</dd>
            </div>
            <div class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.age') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ t('tasks.drawer.days', { n: task.age_days }, task.age_days) }}</dd>
            </div>
            <div v-if="task.cycle_days !== null" class="min-w-0">
              <dt class="text-xs font-medium text-muted">{{ t('tasks.drawer.cycle') }}</dt>
              <dd class="mt-1 wrap-anywhere text-toned">{{ t('tasks.drawer.days', { n: task.cycle_days }, task.cycle_days) }}</dd>
            </div>
          </dl>
        </section>
      </div>
    </template>

    <template #comments>
      <TaskActivity :task="task" mode="comments" />
    </template>

    <template #log>
      <TaskActivity :task="task" mode="log" />
    </template>

    <template #subtasks>
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold text-highlighted">{{ t('tasks.drawer.subtasks') }}</h2>
          <span class="text-xs font-normal text-muted">{{ t('tasks.detail.subtaskProgress', { done: completedSubtasks, total: task.subtasks.length }) }}</span>
        </div>
        <SubtaskList :task="task" :base-path="props.basePath" />
      </section>
    </template>

    <template #attachments>
      <TaskAttachments :key="task.id" :task-id="task.id" :can-write="task.can_write" />
    </template>

    <template #dependencies>
      <DependencyPicker :task="task" />
    </template>
  </UTabs>
</template>
