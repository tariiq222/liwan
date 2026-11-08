<script setup lang="ts">
import type { TaskDetail } from '@liwan/contracts'
import { useTimeline } from '@/composables/useTimeline'
import { activityFeed, type ActivityFilter } from '@/utils/taskActivityFeed'
import CommentComposer from './CommentComposer.vue'
import RecordBlock from '../records/RecordBlock.vue'
import Timeline from './Timeline.vue'

// One timeline query feeds one feed: comments and the log of field changes in time order, a segmented filter
// (all / comments / log) over it, and the composer at the bottom.
const props = defineProps<{ task: TaskDetail }>()
const { t } = useI18n()

const idRef = computed(() => props.task.id)
const { data: timeline, error, refetch, isLoading } = useTimeline(idRef)
const filter = ref<ActivityFilter>('all')
const entries = computed(() => activityFeed(timeline.value ?? [], filter.value))
const filters = computed(() => [
  { value: 'all', label: t('tasks.activity.filterAll'), testId: 'activity-filter-all' },
  { value: 'comments', label: t('tasks.detail.commentsTitle'), testId: 'activity-filter-comments' },
  { value: 'log', label: t('tasks.detail.logTitle'), testId: 'activity-filter-log' },
])
const emptyLabel = computed(() => t(filter.value === 'log' ? 'tasks.activity.empty' : filter.value === 'comments' ? 'tasks.activity.emptyComments' : 'tasks.activity.emptyAll'))
</script>

<template>
  <RecordBlock id="activity" data-testid="task-activity" :title="t('tasks.drawer.activity')">
    <template #actions>
      <SharedSegmentedControl v-model="filter" :items="filters" :label="t('tasks.activity.filter')" data-testid="task-activity-filter" />
    </template>
    <SharedPageState :loading="isLoading" :error="error" @retry="refetch">
      <Timeline data-testid="task-activity-feed" :entries="entries" :task-id="task.id" :empty-label="emptyLabel" />
    </SharedPageState>
    <CommentComposer v-if="task.can_write" :key="task.id" :task-id="task.id" />
  </RecordBlock>
</template>
