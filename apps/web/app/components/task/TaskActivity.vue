<script setup lang="ts">
import type { TaskDetail } from '@nasq/contracts'
import { useTimeline } from '@/composables/useTimeline'
import CommentComposer from './CommentComposer.vue'
import Timeline from './Timeline.vue'

// Activity follows the page's natural scroll. On wide screens the complete
// card stays near the viewport while the longer task body continues below it.
const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()

const idRef = computed(() => props.task.id)
const { data: entries, error, refetch, isLoading } = useTimeline(idRef)
</script>

<template>
  <UCard data-testid="task-activity-card">
    <template #header>
      <h2 class="text-lg font-semibold text-highlighted">{{ t('tasks.detail.activityTitle') }}</h2>
      <p class="mt-1 text-xs text-muted">{{ t('tasks.detail.activityDescription') }}</p>
    </template>
    <div class="space-y-4">
      <SharedPageState v-if="error" :error="error" @retry="refetch" />
      <div v-if="isLoading" role="status" class="py-4 text-sm text-muted">{{ t('tasks.activity.loading') }}</div>
      <Timeline v-else :entries="entries ?? []" />
      <CommentComposer v-if="task.can_write" :key="task.id" :task-id="task.id" />
    </div>
  </UCard>
</template>
