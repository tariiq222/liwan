<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { formatNasqDateTime } from '@/composables/calendarDate'
import { useMyTaskComments, usePostMyTaskComment } from '@/composables/useMyTasks'
import { COMMENT_MAX_LENGTH, commentProblem, oldestFirst } from '@/utils/myTaskDetail'

// Plain text only: the body is rendered as text and sent as typed (no markup, no mentions).
const props = defineProps<{ taskId: number; canWrite: boolean }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { data, isLoading, error: loadError, refetch } = useMyTaskComments(() => props.taskId)
const { mutateAsync: post, isPending } = usePostMyTaskComment()

const body = ref('')
const error = ref('')
const comments = computed(() => oldestFirst(data.value?.items ?? []))
const problem = computed(() => (body.value ? commentProblem(body.value) : null))

// `isPending` of the mutation reaches this guard a macrotask late: a plain flag, set before the
// first await, is what keeps a second click from sending a second comment.
let inFlight = false

async function submit() {
  const text = body.value.trim()
  if (inFlight || !hydrated.value || isPending.value || commentProblem(text)) return
  inFlight = true
  error.value = ''
  try {
    await post({ id: props.taskId, body: text })
    body.value = ''
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.comment')
  } finally {
    inFlight = false
  }
}
</script>

<template>
  <section data-testid="my-task-comments" class="space-y-3" :aria-label="t('myTasks.comments.title')">
    <h2 class="text-lg font-semibold text-highlighted">{{ t('myTasks.comments.title') }}</h2>
    <SharedPageState :loading="isLoading" :error="loadError" :empty="!comments.length" :empty-text="t('myTasks.comments.empty')" @retry="refetch">
      <ul class="divide-y divide-default">
        <li v-for="comment in comments" :key="comment.id" class="grid gap-1 py-3">
          <div class="flex flex-wrap items-baseline gap-x-2 text-xs text-muted">
            <span class="font-medium text-default">{{ comment.author?.name ?? t('myTasks.comments.unknownAuthor') }}</span>
            <time :datetime="comment.created_at">{{ formatNasqDateTime(comment.created_at, locale) }}</time>
          </div>
          <p class="whitespace-pre-wrap break-words text-sm text-default">{{ comment.body }}</p>
        </li>
      </ul>
    </SharedPageState>

    <form v-if="props.canWrite" class="grid gap-2 border-t border-default pt-3" @submit.prevent="submit">
      <UTextarea
        v-model="body"
        :placeholder="t('myTasks.comments.placeholder')"
        :aria-label="t('myTasks.comments.placeholder')"
        :maxlength="COMMENT_MAX_LENGTH + 1"
        class="min-h-22 w-full resize-none"
        :disabled="!hydrated || isPending"
      />
      <p v-if="problem === 'tooLong'" role="alert" class="text-sm text-error">{{ t('myTasks.comments.errors.tooLong') }}</p>
      <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
      <div class="flex justify-end">
        <UButton type="submit" size="sm" :loading="isPending" :disabled="!hydrated || isPending || !body.trim() || problem !== null" :label="t('myTasks.comments.post')" />
      </div>
    </form>
  </section>
</template>
