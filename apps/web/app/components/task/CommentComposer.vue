<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { usePostComment } from '@/composables/useTimeline'

const props = defineProps<{ taskId: number }>()

const { t } = useI18n()
const { mutate: postComment, isPending } = usePostComment()
const hydrated = useHydrated()
const toast = useToast()

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
        toast.add({ title: err instanceof ApiError ? err.message : t('errors.generic'), color: 'error' })
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
  <form class="mt-4 grid gap-2 border-t border-default pt-3.5" @submit.prevent="submit">
    <UFormField :label="t('tasks.activity.add')" :name="`task-comment-${props.taskId}`" class="text-xs font-medium">
      <UTextarea
        :id="`task-comment-${props.taskId}`"
        v-model="body"
        :placeholder="t('tasks.activity.write')"
        :disabled="!hydrated || isPending"
        class="min-h-22 w-full resize-none"
        @keydown="onKeydown"
      />
    </UFormField>
    <div class="flex justify-end">
      <UButton type="submit" size="sm" :loading="isPending" :disabled="!hydrated || isPending || !body.trim()">
        {{ t('tasks.activity.post') }}
      </UButton>
    </div>
  </form>
</template>
