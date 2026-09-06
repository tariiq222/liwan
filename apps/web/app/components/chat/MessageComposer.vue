<script setup lang="ts">
import { Paperclip } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { preserveFailedDraft, shouldSendOnEnter } from '@/utils/chatState'

const props = defineProps<{ conversationId: number }>()
const emit = defineEmits<{ 'update:pending': [string] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const draft = ref('')
const file = ref<File | null>(null)
const sending = ref(false)
const { mutateAsync: send } = useSendChatMessage(() => props.conversationId)

async function fileToPayload(selected: File) {
  const buffer = await selected.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return {
    name: selected.name,
    mimetype: selected.type || undefined,
    data: btoa(binary),
  }
}

async function submit() {
  if (sending.value || (!draft.value.trim() && !file.value)) return
  const body = draft.value
  const selected = file.value
  sending.value = true
  emit('update:pending', body)
  try {
    await send({
      body: body.trim() ? body : undefined,
      attachment: selected ? await fileToPayload(selected) : undefined,
    })
    draft.value = preserveFailedDraft(body, false)
    file.value = null
    emit('update:pending', '')
  } catch (error) {
    draft.value = preserveFailedDraft(body, true)
    emit('update:pending', '')
    toast.error(error instanceof ApiError ? error.message : t('chat.sendFailed'))
  } finally {
    sending.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  if (shouldSendOnEnter(event)) {
    event.preventDefault()
    void submit()
  }
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  input.value = ''
}
</script>

<template>
  <form class="flex flex-col gap-2 border-t p-3" @submit.prevent="submit">
    <p v-if="file" class="truncate text-xs text-muted-foreground">{{ file.name }}</p>
    <div class="flex items-end gap-2">
      <label class="inline-flex size-10 items-center justify-center rounded-lg border">
        <Paperclip class="size-4" />
        <span class="sr-only">{{ t('chat.attach') }}</span>
        <input type="file" class="sr-only" :disabled="!hydrated || sending" @change="onFile">
      </label>
      <textarea
        v-model="draft"
        rows="2"
        class="min-h-10 flex-1 resize-none rounded-lg border bg-background px-3 py-2 text-start"
        :placeholder="t('chat.composerPlaceholder')"
        :disabled="!hydrated || sending"
        @keydown="onKeydown"
      />
      <Button type="submit" :disabled="!hydrated || sending || (!draft.trim() && !file)">{{ t('chat.send') }}</Button>
    </div>
  </form>
</template>
