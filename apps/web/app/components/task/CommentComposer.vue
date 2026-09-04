<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { usePostComment } from '@/composables/useTimeline'

const props = defineProps<{ taskId: number }>()

const { t } = useI18n()
const { mutate: postComment, isPending } = usePostComment()

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
  <div class="border-t p-3">
    <Textarea
      v-model="body"
      :placeholder="t('tasks.activity.write')"
      :disabled="isPending"
      class="min-h-16 resize-none"
      @keydown="onKeydown"
    />
    <div class="mt-2 flex justify-end">
      <Button type="button" size="sm" :disabled="isPending || !body.trim()" @click="submit">
        {{ t('tasks.activity.post') }}
      </Button>
    </div>
  </div>
</template>
