<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { usePostComment } from '@/composables/useTimeline'

const props = defineProps<{ taskId: number }>()

const { t } = useI18n()
const { mutate: postComment, isPending } = usePostComment()
const hydrated = useHydrated()

const body = ref('')

function submit() {
  const text = body.value.trim()
  if (!text || isPending.value) return
  postComment(
    { id: props.taskId, body: text },
    {
      onSuccess: () => {
        body.value = ''
      },
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : t('errors.generic'))
      },
    },
  )
}

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <form class="task-comment-form" @submit.prevent="submit">
    <Label :for="`task-comment-${props.taskId}`" class="text-xs font-medium">{{ t('tasks.activity.add') }}</Label>
    <Textarea
      :id="`task-comment-${props.taskId}`"
      v-model="body"
      :placeholder="t('tasks.activity.write')"
      :disabled="!hydrated || isPending"
      class="min-h-[88px] resize-none"
      @keydown="onKeydown"
    />
    <div class="flex justify-end">
      <Button type="submit" size="sm" :disabled="!hydrated || isPending || !body.trim()">
        {{ t('tasks.activity.post') }}
      </Button>
    </div>
  </form>
</template>

<style scoped>
.task-comment-form {
  display: grid;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
</style>
