<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useTimeline } from '@/composables/useTimeline'
import CommentComposer from './CommentComposer.vue'
import Timeline from './Timeline.vue'

const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()

const idRef = computed(() => props.task.id)
const { data: entries, error, refetch, isLoading } = useTimeline(idRef)
</script>

<template>
  <div data-testid="task-activity-card" class="space-y-4">
    <p class="text-xs text-muted">{{ t('tasks.detail.activityDescription') }}</p>
    <SharedPageState v-if="error" :error="error" @retry="refetch" />
    <div v-if="isLoading" role="status" class="py-4 text-sm text-muted">{{ t('tasks.activity.loading') }}</div>
    <Timeline v-else :entries="entries ?? []" />
    <CommentComposer v-if="task.can_write" :key="task.id" :task-id="task.id" />
  </div>
</template>
