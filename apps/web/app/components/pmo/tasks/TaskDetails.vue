<script setup lang="ts">
import type { TaskDetail } from '@liwan/contracts'
import { useTaskAttachments } from '@/composables/useTaskAttachments'
import { useTaskDependencies } from '@/composables/useTaskDependencies'
import DependencyPicker from './DependencyPicker.vue'
import TaskActivity from './TaskActivity.vue'
import TaskAttachments from './TaskAttachments.vue'
import TaskDescription from './TaskDescription.vue'
import TaskDeliverables from './TaskDeliverables.vue'
import SubtaskList from './SubtaskList.vue'

// The record's main column, without cards: the description as plain text, the deliverables, the sub-tasks, then the
// attachments and predecessors (a small button each while empty, a section once they hold something), the schedule a
// host passes through the `schedule` slot (it brings its own section), and the activity feed.
const props = withDefaults(defineProps<{ task: TaskDetail; basePath?: string }>(), {
  basePath: '/tasks',
})

const { t } = useI18n()
const hydrated = useHydrated()

const { data: attachments, isError: attachmentsFailed } = useTaskAttachments(() => props.task.id)
const dependencyTaskId = computed(() => props.task.planning_enabled ? props.task.id : null)
const { data: dependencyState } = useTaskDependencies(dependencyTaskId)

const attachmentsOpen = ref(false)
const dependenciesOpen = ref(false)

const attachmentCount = computed(() => attachments.value?.items.length ?? 0)
const dependencyCount = computed(() => dependencyState.value?.items.length ?? props.task.depends_on.length)
// The host keys this component by task, so a new task starts closed. A section that held something stays on screen when its last row goes, so removing the last item is not a jump.
watch(attachmentCount, count => { if (count > 0) attachmentsOpen.value = true }, { immediate: true })
// A failed load opens the section too, so the attachments card can show its own error and retry instead of vanishing.
watch(attachmentsFailed, failed => { if (failed) attachmentsOpen.value = true }, { immediate: true })
watch(dependencyCount, count => { if (count > 0) dependenciesOpen.value = true }, { immediate: true })
const showAttachments = computed(() => attachmentsOpen.value)
const showDependencies = computed(() => props.task.planning_enabled && dependenciesOpen.value)
const canAddAttachment = computed(() => props.task.can_write && !showAttachments.value && attachments.value !== undefined)
const canAddDependency = computed(() => props.task.planning_enabled && props.task.can_manage_dependencies && !showDependencies.value)
</script>

<template>
  <TaskDescription :key="task.id" :task="task" />
  <TaskDeliverables :key="`outputs-${task.id}`" :task="task" />
  <SubtaskList :task="task" :base-path="props.basePath" />
  <DependencyPicker v-if="showDependencies" :task="task" />
  <TaskAttachments v-if="showAttachments" :key="task.id" :task-id="task.id" :can-write="task.can_write" />
  <div v-if="canAddAttachment || canAddDependency" data-testid="task-add-row" class="flex flex-wrap items-center gap-2">
    <UButton v-if="canAddAttachment" data-testid="task-add-attachment" color="neutral" variant="outline" size="sm" icon="i-lucide-paperclip" :disabled="!hydrated" :label="t('tasks.detail.addAttachment')" @click="attachmentsOpen = true" />
    <UButton v-if="canAddDependency" data-testid="task-add-dependency" color="neutral" variant="outline" size="sm" icon="i-lucide-git-branch-plus" :disabled="!hydrated" :label="t('tasks.detail.addDependsOn')" @click="dependenciesOpen = true" />
  </div>
  <slot v-if="task.planning_enabled" name="schedule" :task="task" />
  <TaskActivity :task="task" />
</template>
