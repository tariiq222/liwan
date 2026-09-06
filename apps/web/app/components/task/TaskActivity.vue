<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useTimeline } from '@/composables/useTimeline'
import CommentComposer from './CommentComposer.vue'
import Timeline from './Timeline.vue'

// Header-less activity column: the timeline scrolls on its own, the composer
// stays pinned at the foot regardless of how tall the timeline grows. The
// parent (TaskDetailPanel) gives this component the full column height and
// leaves scrolling entirely to it — see the comment there.
const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()

const idRef = computed(() => props.task.id)
const { data: entries } = useTimeline(idRef)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden">
    <header class="shrink-0 border-b px-4 py-3">
      <h2 class="text-sm font-semibold">{{ t('tasks.detail.activityTitle') }}</h2>
    </header>
    <div class="flex-1 overflow-y-auto p-4">
      <Timeline :entries="entries ?? []" />
    </div>
    <CommentComposer v-if="task.can_write" :task-id="task.id" />
  </div>
</template>
