<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useMyTaskComments, usePostMyTaskComment } from '@/composables/useMyTasks'
import { COMMENT_MAX_LENGTH, commentProblem, oldestFirst } from '@/utils/myTaskDetail'

// The personal task's wiring of `SharedCommentThread` and `SharedCommentComposer`.
// Plain text only: the body is rendered as text and sent as typed (no markup, no mentions).
const props = withDefaults(defineProps<{ taskId: number; canWrite: boolean; discardDraftKey?: number }>(), { discardDraftKey: 0 })
const emit = defineEmits<{ 'draft-change': [dirty: boolean]; 'pending-change': [pending: boolean] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { data, isLoading, error: loadError, refetch } = useMyTaskComments(() => props.taskId)
const { mutateAsync: post, isPending } = usePostMyTaskComment()

const body = ref('')
watch(body, value => emit('draft-change', !!value.trim()), { flush: 'sync' })
watch(() => props.discardDraftKey, () => { body.value = '' })
onBeforeUnmount(() => { emit('draft-change', false); emit('pending-change', false) })
const error = ref('')
const comments = computed(() => oldestFirst(data.value?.items ?? []).map(comment => ({
  id: comment.id,
  authorName: comment.author?.name ?? null,
  createdAt: comment.created_at,
  body: comment.body,
})))
const problem = computed(() => (body.value ? commentProblem(body.value) : null))

// `isPending` of the mutation reaches this guard a macrotask late: a plain flag, set before the
// first await, is what keeps a second click from sending a second comment.
let inFlight = false

async function submit() {
  const text = body.value.trim()
  if (inFlight || !hydrated.value || isPending.value || commentProblem(text)) return
  inFlight = true
  emit('pending-change', true)
  error.value = ''
  try {
    await post({ id: props.taskId, body: text })
    body.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.comment')
  } finally {
    inFlight = false
    emit('pending-change', false)
  }
}
</script>

<template>
  <SharedRecordSection data-testid="my-task-comments" :title="t('myTasks.comments.title')">
    <SharedCommentThread
      :comments="comments"
      :empty-text="t('myTasks.comments.empty')"
      :unknown-author="t('myTasks.comments.unknownAuthor')"
      :loading="isLoading"
      :error="loadError"
      @retry="refetch"
    >
      <template v-if="props.canWrite" #composer>
        <SharedCommentComposer
          v-model="body"
          :placeholder="t('myTasks.comments.placeholder')"
          :submit-label="t('myTasks.comments.post')"
          :max-length="COMMENT_MAX_LENGTH + 1"
          :pending="isPending"
          :invalid="problem !== null"
          :problem="problem === 'tooLong' ? t('myTasks.comments.errors.tooLong') : undefined"
          :error="error"
          @submit="submit"
        />
      </template>
    </SharedCommentThread>
  </SharedRecordSection>
</template>
