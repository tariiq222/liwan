<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { ATTACHMENT_ACCEPT, attachmentProblem, fileToBase64 } from '@/utils/attachmentFile'
import { composerKeyAction, mentionIdsInText, moveHighlight, shouldNotifyTyping, type ChatMention } from '@/utils/chatComposer'
import { preserveFailedDraft } from '@/utils/chatState'

import type { ChatMessage } from '@webvue/contracts'

const props = defineProps<{ conversationId: number; replyTo?: ChatMessage | null }>()
const emit = defineEmits<{ 'update:pending': [string]; 'clear-reply': [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
// A parent that must outlive this form (the phone's info panel unmounts it) binds the draft; unbound it stays local.
const draft = defineModel<string>('draft', { default: '' })
const file = ref<File | null>(null)
const fileError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const sending = ref(false)
const pickedMentions = ref<ChatMention[]>([])
const { mutateAsync: send } = useSendChatMessage(() => props.conversationId)
const { mutate: notifyTyping } = useChatTyping(() => props.conversationId)
const { data: members } = useChatMembers(() => props.conversationId)
let typingTimer: ReturnType<typeof setTimeout> | undefined
let typingSentAt = 0

const mentionQuery = computed(() => {
  const match = draft.value.match(/(?:^|\s)@(\S*)$/)
  return match?.[1]?.toLowerCase() ?? ''
})
const mentionChoices = computed(() => {
  if (!draft.value.match(/(?:^|\s)@$/) && !mentionQuery.value) return []
  const q = mentionQuery.value
  return (members.value?.items ?? []).filter(item => !q || item.name.toLowerCase().includes(q)).slice(0, 6)
})
const mentionDismissed = ref(false)
const highlighted = ref(0)
const mentionOpen = computed(() => mentionChoices.value.length > 0 && !mentionDismissed.value)
const optionId = (index: number) => `chat-mention-option-${index}`
watch(mentionChoices, () => { highlighted.value = 0 })
watch(draft, () => { mentionDismissed.value = false })

function pickMention(person: ChatMention) {
  draft.value = draft.value.replace(/@\S*$/, `@${person.name} `)
  if (!pickedMentions.value.some(item => item.id === person.id)) pickedMentions.value = [...pickedMentions.value, { id: person.id, name: person.name }]
}

function onDraft() {
  clearTimeout(typingTimer)
  const now = Date.now()
  if (shouldNotifyTyping(typingSentAt, now)) {
    typingSentAt = now
    notifyTyping(true)
  }
  typingTimer = setTimeout(() => {
    typingSentAt = 0
    notifyTyping(false)
  }, 3000)
}

async function submit() {
  if (sending.value || (!draft.value.trim() && !file.value)) return
  const body = draft.value
  const selected = file.value
  // Only the people whose @name is still in the text are mentioned.
  const mentionIds = mentionIdsInText(body, [...pickedMentions.value, ...(members.value?.items ?? [])])
  sending.value = true
  emit('update:pending', body)
  try {
    await send({
      body: body.trim() ? body : undefined,
      attachment: selected ? { name: selected.name, mimetype: selected.type || undefined, data: await fileToBase64(selected) } : undefined,
      parent_id: props.replyTo?.id,
      mention_user_ids: mentionIds.length ? mentionIds : undefined,
    })
    draft.value = preserveFailedDraft(body, false)
    file.value = null
    pickedMentions.value = []
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
  const action = composerKeyAction(event, mentionOpen.value)
  if (!action) return
  event.preventDefault()
  if (action === 'send') void submit()
  else if (action === 'close') mentionDismissed.value = true
  else if (action === 'pick') pickMention(mentionChoices.value[highlighted.value]!)
  else highlighted.value = moveHighlight(highlighted.value, action === 'next' ? 1 : -1, mentionChoices.value.length)
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const selected = input.files?.[0] ?? null
  input.value = ''
  if (!selected) return
  // The type and size rules run before the file is read; the server stays the authority.
  const problem = attachmentProblem(selected)
  fileError.value = problem ? t(`chat.attachmentErrors.${problem}`) : ''
  file.value = problem ? null : selected
}

function removeFile() {
  file.value = null
  fileError.value = ''
}

onUnmounted(() => {
  clearTimeout(typingTimer)
  notifyTyping(false)
})
</script>

<template>
  <form class="webvue-chat-composer" @submit.prevent="submit">
    <p v-if="props.replyTo" class="flex items-center justify-between px-1 text-xs text-muted">
      <span>{{ t('chat.replyingTo', { name: props.replyTo.author.name }) }}</span>
      <UButton type="button" color="neutral" variant="ghost" size="xs" :label="t('app.cancel')" @click="emit('clear-reply')" />
    </p>
    <ul v-if="mentionOpen" id="chat-mention-list" role="listbox" :aria-label="t('chat.mentionPeople')" class="overflow-hidden rounded-control bg-default text-sm ring ring-default">
      <li
        v-for="(person, index) in mentionChoices"
        :id="optionId(index)"
        :key="person.id"
        role="option"
        :aria-selected="index === highlighted"
        class="cursor-pointer px-3 py-1.5 text-start hover:bg-elevated"
        :class="{ 'bg-elevated': index === highlighted }"
        @mousedown.prevent="pickMention(person)"
      >{{ person.name }}</li>
    </ul>
    <p v-if="fileError" role="alert" class="px-1 text-xs text-error">{{ fileError }}</p>
    <p v-if="file" class="flex items-center gap-1 px-1 text-xs text-muted">
      <span class="min-w-0 flex-1 truncate">{{ file.name }}</span>
      <UButton type="button" color="neutral" variant="ghost" size="xs" square icon="i-lucide-x" :aria-label="t('chat.removeAttachment', { name: file.name })" :disabled="sending" @click="removeFile" />
    </p>
    <div class="flex items-end gap-2">
      <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-paperclip" :aria-label="t('chat.attach')" :disabled="!hydrated || sending" @click="fileInput?.click()" />
      <input ref="fileInput" type="file" class="hidden" tabindex="-1" :accept="ATTACHMENT_ACCEPT" :disabled="!hydrated || sending" @change="onFile">
      <UTextarea
        v-model="draft"
        :rows="1"
        class="min-w-0 flex-1"
        autoresize
        :aria-label="t('chat.composerPlaceholder')"
        :placeholder="t('chat.composerPlaceholder')"
        :disabled="!hydrated || sending"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="chat-mention-list"
        :aria-expanded="mentionOpen"
        :aria-activedescendant="mentionOpen ? optionId(highlighted) : undefined"
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
        <UIcon name="i-lucide-send" class="size-4 rtl:rotate-180" aria-hidden="true" />
      </UButton>
    </div>
  </form>
</template>
