<script setup lang="ts">
import type { TaskDetail } from '@webvue/contracts'
import { useTimeline } from '@/composables/useTimeline'
import CommentComposer from './CommentComposer.vue'
import Timeline from './Timeline.vue'

// One timeline query feeds two tabs: `comments` is the conversation with its
// composer, `log` is the read-only record of field changes.
const props = withDefaults(defineProps<{ task: TaskDetail; mode?: 'comments' | 'log' }>(), { mode: 'comments' })
const { t } = useI18n()

const idRef = computed(() => props.task.id)
const { data: timeline, error, refetch, isLoading } = useTimeline(idRef)
const entries = computed(() => (timeline.value ?? []).filter(entry => (entry.kind === 'comment') === (props.mode === 'comments')))
</script>

<template>
  <div :data-testid="mode === 'log' ? 'task-activity-card' : 'task-comments-card'" class="space-y-4">
    <p v-if="mode === 'log'" class="text-xs text-muted">{{ t('tasks.detail.logDescription') }}</p>
    <SharedPageState :loading="isLoading" :error="error" @retry="refetch">
      <Timeline :entries="entries" :task-id="task.id" :empty-label="t(mode === 'log' ? 'tasks.activity.empty' : 'tasks.activity.emptyComments')" />
    </SharedPageState>
    <CommentComposer v-if="task.can_write && mode !== 'log'" :key="task.id" :task-id="task.id" />
  </div>
</template>
