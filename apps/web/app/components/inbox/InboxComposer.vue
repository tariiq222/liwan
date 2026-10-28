<script setup lang="ts">
import type { InboxAttachment, InboxConversationDetail } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useInboxCannedReplies, useInboxTemplates, useInboxTyping, useSendInboxNote, useSendInboxReply } from '@/composables/inbox/useInbox'
import { INBOX_UPLOAD_ACCEPT, inboxFileSize, inboxUploadProblem } from '@/composables/inbox/inboxAttachments'
import { emptyInboxDraft, inboxDrafts } from '@/composables/inbox/inboxDrafts'
import { buildInteractive, emptyInteractiveDraft } from '@/composables/inbox/inboxInteractive'
import { buildLocation, emptyLocationDraft } from '@/composables/inbox/inboxLocation'
import { uploadInboxFile } from '@/composables/inbox/inboxUpload'
import { cannedSuggestions, renderTemplateBody, replyWindowOpen } from '@/composables/inbox/inboxWindow'

// Three ways to write: a reply (inside the 24-hour customer-service window) that is text, a file with a caption, a
// location or an interactive message and may quote one message, an approved template with its parameters (the only
// reply after the window), and an internal note the customer never sees. Typing "/" at the start of a reply suggests
// canned replies; typing tells the customer's phone the agent is writing.
const props = defineProps<{ conversation: InboxConversationDetail; replyTo?: { id: number; preview: string } | null }>()
const emit = defineEmits<{ 'update:replyTo': [target: { id: number; preview: string } | null] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { me } = useMe()
const mode = ref<'reply' | 'note'>('reply')
// Reply and note keep their own text, so switching the mode never loses what was typed.
const texts = reactive({ reply: '', note: '' })
const draft = computed({ get: () => texts[mode.value], set: (value: string) => { texts[mode.value] = value } })
const templateId = ref<number | undefined>(undefined)
const params = ref<string[]>([])
const highlighted = ref(0)
const suggestionsDismissed = ref(false)
const panel = ref<'location' | 'interactive' | null>(null)
const location = ref(emptyLocationDraft())
const interactive = ref(emptyInteractiveDraft())
// The file being attached: sent after the upload finishes, with the draft text as its caption.
const upload = ref<{ name: string; size: number; progress: number; attachment: InboxAttachment | null } | null>(null)
const uploadError = ref('')
const fileField = ref<{ reset: () => void } | null>(null)
let uploadSeq = 0

// The window closes by itself: a clock that ticks only at the expiry keeps the cached computed honest.
const now = ref(Date.now())
let expiry: ReturnType<typeof setTimeout> | undefined
function scheduleExpiry(endsAt: string | null) {
  clearTimeout(expiry)
  now.value = Date.now()
  if (!endsAt) return
  const remaining = Date.parse(endsAt) - now.value
  if (remaining > 0) expiry = setTimeout(() => { now.value = Date.now() }, remaining + 50)
}
watch(() => props.conversation.reply_window_ends_at, scheduleExpiry, { immediate: true })
onBeforeUnmount(() => clearTimeout(expiry))
const windowOpen = computed(() => replyWindowOpen(props.conversation, now.value))
const templateMode = computed(() => mode.value === 'reply' && !windowOpen.value)
const conversationId = computed(() => props.conversation.id)
const { mutateAsync: sendReply, isPending: replying } = useSendInboxReply(conversationId)
const { mutateAsync: sendNote, isPending: noting } = useSendInboxNote(conversationId)
const sending = computed(() => replying.value || noting.value)
const notifyTyping = useInboxTyping(conversationId)
const { data: canned } = useInboxCannedReplies()
const { data: templates, isLoading: templatesLoading, isError: templatesFailed, refetch: reloadTemplates } = useInboxTemplates(() => props.conversation.channel.id, templateMode)

const suggestions = computed(() => mode.value === 'reply' && windowOpen.value && !suggestionsDismissed.value ? cannedSuggestions(draft.value, canned.value?.items ?? []) : [])
const selectedTemplate = computed(() => templates.value?.items.find(item => item.id === templateId.value))
const templateItems = computed(() => (templates.value?.items ?? []).map(item => ({ value: item.id, label: `${item.name} · ${item.language}` })))
const modeItems = computed(() => [
  { value: 'reply', label: t('inbox.composer.reply'), icon: 'i-lucide-reply' },
  { value: 'note', label: t('inbox.composer.note'), icon: 'i-lucide-lock' },
])
const preview = computed(() => selectedTemplate.value ? renderTemplateBody(selectedTemplate.value.body, params.value) : '')
const paramsFilled = computed(() => !selectedTemplate.value || params.value.slice(0, selectedTemplate.value.param_count).every(value => value.trim()))
const textareaLabel = computed(() => mode.value === 'note' ? t('inbox.composer.notePlaceholder') : upload.value ? t('inbox.composer.captionPlaceholder') : t('inbox.composer.placeholder'))
const uploading = computed(() => !!upload.value && !upload.value.attachment)
const quoted = computed(() => (mode.value === 'reply' && !templateMode.value ? props.replyTo ?? null : null))
const composing = computed(() => mode.value === 'reply' && !templateMode.value)
const replyReady = computed(() => {
  if (panel.value === 'location') return !!buildLocation(location.value)
  if (panel.value === 'interactive') return !!buildInteractive(interactive.value)
  return !uploading.value && (!!upload.value || !!draft.value.trim())
})
const canSend = computed(() => hydrated.value && !sending.value && (templateMode.value ? !!selectedTemplate.value && paramsFilled.value : mode.value === 'note' ? !!draft.value.trim() : replyReady.value))

watch(draft, (value) => {
  suggestionsDismissed.value = false
  highlighted.value = 0
  if (value && composing.value) notifyTyping()
})
// A restored draft keeps its parameters; choosing another template starts them empty.
watch(selectedTemplate, (template, previous) => {
  if (previous && template && previous.id !== template.id) params.value = []
  const count = template?.param_count ?? 0
  if (params.value.length !== count) params.value = Array.from({ length: count }, (_, index) => params.value[index] ?? '')
})

// Drafts live per conversation (the workspace keys this component by conversation). Restored after mount so the
// server-rendered and first client render agree; every change is stored, and a successful send clears what it sent.
const hydratedDraft = ref(false)
onMounted(() => {
  if (me.value?.id) {
    const stored = inboxDrafts.get(me.value.id, props.conversation.id)
    texts.reply = stored.reply
    texts.note = stored.note
    templateId.value = stored.templateId ?? undefined
    params.value = stored.params
    if (stored.replyTo && !props.replyTo) emit('update:replyTo', stored.replyTo)
    if (stored.location) { location.value = stored.location; panel.value = 'location' }
    if (stored.interactive) { interactive.value = stored.interactive; panel.value = 'interactive' }
  }
  hydratedDraft.value = true
})
watch([() => texts.reply, () => texts.note, templateId, params, () => props.replyTo, panel, location, interactive], () => {
  if (!hydratedDraft.value || !me.value?.id) return
  inboxDrafts.set(me.value.id, props.conversation.id, {
    ...emptyInboxDraft(),
    reply: texts.reply,
    note: texts.note,
    templateId: templateId.value ?? null,
    params: [...params.value],
    replyTo: props.replyTo ?? null,
    location: panel.value === 'location' ? { ...location.value } : null,
    interactive: panel.value === 'interactive' ? JSON.parse(JSON.stringify(interactive.value)) : null,
  })
}, { deep: true })

// Opening a panel starts it empty and closing it discards it, so no half-built message lingers in the draft.
function togglePanel(next: 'location' | 'interactive') {
  const closing = panel.value === next
  panel.value = closing ? null : next
  if (next === 'location') location.value = emptyLocationDraft()
  else interactive.value = emptyInteractiveDraft()
  if (!closing) discardUpload()
}
function discardUpload() {
  uploadSeq++
  upload.value = null
  uploadError.value = ''
}

async function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  fileField.value?.reset()
  if (!file) return
  discardUpload()
  const problem = inboxUploadProblem(file)
  if (problem) {
    uploadError.value = t(`inbox.composer.upload.${problem.reason}`, { name: file.name, limit: problem.reason === 'tooLarge' ? problem.limitMb : 0 })
    return
  }
  panel.value = null
  const current = ++uploadSeq
  upload.value = { name: file.name, size: file.size, progress: 0, attachment: null }
  try {
    const attachment = await uploadInboxFile(conversationId.value, file, (fraction) => { if (current === uploadSeq && upload.value) upload.value.progress = fraction })
    if (current === uploadSeq && upload.value) upload.value.attachment = attachment
  } catch (e) {
    if (current !== uploadSeq) return
    upload.value = null
    uploadError.value = e instanceof ApiError && e.status === 413 ? t('inbox.composer.upload.tooLargeServer') : t('inbox.composer.upload.failed')
  }
}

function pickSuggestion(body: string) {
  draft.value = body
}
function onKeydown(event: KeyboardEvent) {
  if (suggestions.value.length) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      highlighted.value = (highlighted.value + step + suggestions.value.length) % suggestions.value.length
      return
    }
    if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
      event.preventDefault()
      pickSuggestion(suggestions.value[highlighted.value]!.body)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      suggestionsDismissed.value = true
      return
    }
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault()
    void submit()
  }
}

// What the reply carries: the open panel, else the uploaded file with the text as its caption, else the text.
function replyContent() {
  if (panel.value === 'location') return { location: buildLocation(location.value)! }
  if (panel.value === 'interactive') return { interactive: buildInteractive(interactive.value)! }
  const caption = draft.value.trim()
  if (upload.value?.attachment) return { attachment_id: upload.value.attachment.id, ...(caption ? { caption } : {}) }
  return { body: caption }
}

async function submit() {
  if (!canSend.value) return
  try {
    if (templateMode.value) {
      await sendReply({ template_id: selectedTemplate.value!.id, params: params.value.slice(0, selectedTemplate.value!.param_count).map(value => value.trim()) })
      templateId.value = undefined
      params.value = []
    } else if (mode.value === 'note') {
      await sendNote({ body: draft.value.trim() })
      texts.note = ''
    } else {
      await sendReply({ ...replyContent(), ...(props.replyTo ? { reply_to_id: props.replyTo.id } : {}) })
      texts.reply = ''
      panel.value = null
      discardUpload()
      emit('update:replyTo', null)
    }
  } catch (e) {
    // The draft stays so nothing typed is lost; the server's reason (for example a closed window) is shown.
    toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <form class="flex flex-col gap-2 border-t border-default bg-default px-3 pt-2 pb-3" data-testid="inbox-composer" @submit.prevent="submit">
    <SharedSegmentedControl v-model="mode" class="self-start" :items="modeItems" :label="t('inbox.composer.mode')" />
    <UAlert
      v-if="templateMode"
      color="info"
      variant="subtle"
      icon="i-lucide-clock"
      data-testid="inbox-window-closed"
      :title="t('inbox.composer.windowClosed')"
      :description="props.conversation.reply_window_ends_at ? t('inbox.composer.windowClosedDescription') : t('inbox.composer.noWindow')"
    />
    <template v-if="templateMode">
      <SharedLoadingSkeleton v-if="templatesLoading" />
      <UAlert v-else-if="templatesFailed" role="alert" color="error" variant="subtle" :title="t('inbox.composer.templatesFailed')">
        <template #actions><UButton type="button" color="neutral" variant="outline" :label="t('app.retry')" @click="reloadTemplates()" /></template>
      </UAlert>
      <p v-else-if="!templateItems.length" class="text-sm text-muted" data-testid="inbox-no-templates">{{ t('inbox.composer.noTemplates') }}</p>
      <template v-else>
        <UFormField :label="t('inbox.composer.template')">
          <USelect v-model="templateId" class="w-full" :items="templateItems" :placeholder="t('inbox.composer.pickTemplate')" :disabled="!hydrated || sending" data-testid="inbox-template-select" />
        </UFormField>
        <div v-if="selectedTemplate" class="flex flex-col gap-2">
          <UFormField v-for="(_, index) in params" :key="index" :label="t('inbox.composer.param', { n: index + 1 })" required>
            <UInput v-model="params[index]" class="w-full" maxlength="1024" :disabled="!hydrated || sending" />
          </UFormField>
          <SharedSubCard tone="tinted">
            <p class="text-xs text-muted">{{ t('inbox.composer.preview') }}</p>
            <p class="mt-1 text-sm whitespace-pre-wrap" data-testid="inbox-template-preview">{{ preview }}</p>
          </SharedSubCard>
        </div>
      </template>
    </template>
    <template v-else>
      <div v-if="quoted" class="flex items-center gap-2 rounded-control border-s-2 border-primary bg-elevated/50 py-1.5 ps-3 pe-1 text-sm" data-testid="inbox-reply-chip">
        <UIcon name="i-lucide-reply" class="size-4 shrink-0 text-muted" aria-hidden="true" />
        <p class="min-w-0 flex-1 truncate"><span class="font-medium">{{ t('inbox.composer.replyingTo') }}</span> <span class="text-muted">{{ quoted.preview || t('inbox.composer.quotedMedia') }}</span></p>
        <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('inbox.composer.cancelReplyTo')" @click="emit('update:replyTo', null)" />
      </div>
      <div v-if="mode === 'reply'" class="flex flex-wrap items-center gap-2" role="toolbar" :aria-label="t('inbox.composer.attachments')">
        <SharedFileField ref="fileField" :accept="INBOX_UPLOAD_ACCEPT" :label="t('inbox.composer.attach')" :show-file-name="false" :disabled="!hydrated || sending || uploading" data-testid="inbox-attach" @change="onFilePicked" />
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-map-pin" :label="t('inbox.composer.location.title')" :aria-pressed="panel === 'location'" :disabled="!hydrated || sending" data-testid="inbox-location-toggle" @click="togglePanel('location')" />
        <UButton type="button" color="neutral" variant="outline" icon="i-lucide-list-checks" :label="t('inbox.composer.interactive.title')" :aria-pressed="panel === 'interactive'" :disabled="!hydrated || sending" data-testid="inbox-interactive-toggle" @click="togglePanel('interactive')" />
      </div>
      <p v-if="uploadError" class="text-sm text-error" role="alert" data-testid="inbox-upload-error">{{ uploadError }}</p>
      <div v-if="upload" class="flex items-center gap-2 rounded-control bg-elevated/50 px-3 py-1.5 text-sm" data-testid="inbox-upload">
        <UIcon name="i-lucide-paperclip" class="size-4 shrink-0 text-muted" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ upload.name }}</span>
        <span class="shrink-0 text-xs text-muted">{{ inboxFileSize(upload.size) }}</span>
        <UProgress v-if="uploading" class="w-24 shrink-0" size="xs" :model-value="Math.round(upload.progress * 100)" :aria-label="t('inbox.composer.uploading', { name: upload.name })" />
        <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('inbox.composer.removeFile')" @click="discardUpload" />
      </div>
      <InboxLocationForm v-if="panel === 'location'" v-model="location" />
      <InboxInteractiveBuilder v-else-if="panel === 'interactive'" v-model="interactive" />
      <ul v-if="suggestions.length" id="inbox-canned-list" role="listbox" :aria-label="t('inbox.composer.canned')" class="overflow-hidden rounded-control bg-default text-sm ring ring-default">
        <li
          v-for="(reply, index) in suggestions"
          :id="`inbox-canned-${index}`"
          :key="reply.id"
          role="option"
          :aria-selected="index === highlighted"
          class="flex cursor-pointer gap-2 px-3 py-1.5 text-start hover:bg-elevated"
          :class="{ 'bg-elevated': index === highlighted }"
          @mousedown.prevent="pickSuggestion(reply.body)"
        >
          <span class="shrink-0 font-medium">/{{ reply.shortcut.replace(/^\//, '') }}</span>
          <span class="min-w-0 truncate text-muted">{{ reply.body }}</span>
        </li>
      </ul>
      <UTextarea
        v-if="mode === 'note' || !panel"
        v-model="draft"
        :rows="2"
        autoresize
        class="w-full"
        :maxrows="8"
        maxlength="4096"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="inbox-canned-list"
        :aria-expanded="suggestions.length > 0"
        :aria-activedescendant="suggestions.length ? `inbox-canned-${highlighted}` : undefined"
        :aria-label="textareaLabel"
        :placeholder="textareaLabel"
        :disabled="!hydrated || sending"
        @keydown="onKeydown"
      />
    </template>
    <div v-if="!templateMode || selectedTemplate" class="flex items-center justify-between gap-2">
      <p v-if="mode === 'reply' && !templateMode && !panel" class="text-xs text-muted">{{ t('inbox.composer.cannedHint') }}</p>
      <p v-else-if="mode === 'note'" class="text-xs text-muted">{{ t('inbox.composer.noteHint') }}</p>
      <span v-else />
      <UButton type="submit" :disabled="!canSend" :loading="sending" :label="mode === 'note' ? t('inbox.composer.saveNote') : t('inbox.composer.send')" />
    </div>
  </form>
</template>
