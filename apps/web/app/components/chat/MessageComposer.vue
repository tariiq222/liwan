<script setup lang="ts">
import { Paperclip, Send } from '@lucide/vue'
import { ApiError } from '@/composables/useApi'
import { preserveFailedDraft, shouldSendOnEnter } from '@/utils/chatState'

import type { ChatMessage } from '@nasq/contracts'

const props = defineProps<{ conversationId: number; replyTo?: ChatMessage | null }>()
const emit = defineEmits<{ 'update:pending': [string]; 'clear-reply': [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const draft = ref('')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const sending = ref(false)
const mentionIds = ref<number[]>([])
const { mutateAsync: send } = useSendChatMessage(() => props.conversationId)
const { mutate: notifyTyping } = useChatTyping(() => props.conversationId)
const { data: members } = useChatMembers(() => props.conversationId)
let typingTimer: ReturnType<typeof setTimeout> | undefined

const mentionQuery = computed(() => {
  const match = draft.value.match(/(?:^|\s)@(\S*)$/)
  return match?.[1]?.toLowerCase() ?? ''
})
const mentionChoices = computed(() => {
  if (!draft.value.match(/(?:^|\s)@$/) && !mentionQuery.value) return []
  const q = mentionQuery.value
  return (members.value?.items ?? []).filter(item => !q || item.name.toLowerCase().includes(q)).slice(0, 6)
})

function pickMention(person: { id: number; name: string }) {
  draft.value = draft.value.replace(/@\S*$/, `@${person.name} `)
  if (!mentionIds.value.includes(person.id)) mentionIds.value = [...mentionIds.value, person.id]
}

function onDraft() {
  clearTimeout(typingTimer)
  notifyTyping(true)
  typingTimer = setTimeout(() => notifyTyping(false), 3000)
}

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
      parent_id: props.replyTo?.id,
      mention_user_ids: mentionIds.value.length ? mentionIds.value : undefined,
    })
    draft.value = preserveFailedDraft(body, false)
    file.value = null
    mentionIds.value = []
    notifyTyping(false)
    emit('update:pending', '')
    emit('clear-reply')
  } catch (error) {
    draft.value = preserveFailedDraft(body, true)
    emit('update:pending', '')
    toast.add({ title: error instanceof ApiError ? error.message : t('chat.sendFailed'), color: 'error' })
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

onUnmounted(() => {
  clearTimeout(typingTimer)
  notifyTyping(false)
})
</script>

<template>
  <form class="nasq-chat-composer" @submit.prevent="submit">
    <p v-if="props.replyTo" class="flex items-center justify-between px-1 text-xs text-muted-foreground">
      <span>{{ t('chat.replyingTo', { name: props.replyTo.author.name }) }}</span>
      <UButton type="button" color="neutral" variant="ghost" size="xs" :label="t('app.cancel')" @click="emit('clear-reply')" />
    </p>
    <ul v-if="mentionChoices.length" class="rounded-md border bg-background text-sm">
      <li v-for="person in mentionChoices" :key="person.id">
        <UButton type="button" color="neutral" variant="ghost" class="w-full justify-start px-3 py-1 text-start" :label="person.name" @click="pickMention(person)" />
      </li>
    </ul>
    <p v-if="file" class="truncate px-1 text-xs text-muted-foreground">{{ file.name }}</p>
    <div class="flex items-end gap-2">
      <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-paperclip" :aria-label="t('chat.attach')" :disabled="!hydrated || sending" @click="fileInput?.click()" />
      <input ref="fileInput" type="file" class="hidden" tabindex="-1" :disabled="!hydrated || sending" @change="onFile">
      <UTextarea
        v-model="draft"
        :rows="1"
        class="min-w-0 flex-1"
        autoresize
        :aria-label="t('chat.composerPlaceholder')"
        :placeholder="t('chat.composerPlaceholder')"
        :disabled="!hydrated || sending"
        @keydown="onKeydown"
        @input="onDraft"
      />
      <UButton
        type="submit"
        square
        :disabled="!hydrated || sending || (!draft.trim() && !file)"
        :aria-label="t('chat.send')"
        :title="t('chat.send')"
      >
        <Send class="size-4 rtl:rotate-180" aria-hidden="true" />
      </UButton>
    </div>
  </form>
</template>
