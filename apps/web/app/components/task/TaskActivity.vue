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
const { data: entries } = useTimeline(idRef)
</script>

<template>
  <section data-testid="task-activity-card" class="nasq-panel task-activity-card">
    <header class="nasq-panel-header">
      <div>
        <h2 class="text-sm font-semibold">{{ t('tasks.detail.activityTitle') }}</h2>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('tasks.detail.activityDescription') }}</p>
      </div>
    </header>
    <div class="nasq-panel-body">
      <Timeline :entries="entries ?? []" />
      <CommentComposer v-if="task.can_write" :task-id="task.id" />
    </div>
  </section>
</template>
