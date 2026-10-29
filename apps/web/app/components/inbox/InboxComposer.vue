<script setup lang="ts">
import type { InboxAttachment, InboxConversationDetail, InboxReplyCreate } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useInboxCannedReplies, useInboxTemplates, useInboxTyping, useSendInboxNote, useSendInboxReply, useUploadInboxFile } from '@/composables/inbox/useInbox'
import { INBOX_CAPTION_MAX, INBOX_UPLOAD_ACCEPT, inboxAcceptsCaption, inboxFileSize, inboxUploadProblem } from '@/composables/inbox/inboxAttachments'
import { emptyInboxDraft, inboxDrafts } from '@/composables/inbox/inboxDrafts'
import { buildInteractive, emptyInteractiveDraft } from '@/composables/inbox/inboxInteractive'
import { buildLocation, emptyLocationDraft } from '@/composables/inbox/inboxLocation'
import { TEMPLATE_CATEGORY_TONE, templatePreview } from '@/composables/inbox/inboxTemplate'
import { HEADER_MEDIA_ACCEPT, buildTemplateReply, dynamicButtons, headerInput, templateReplyReady } from '@/composables/inbox/inboxTemplateSend'
import { cannedSuggestions, replyWindowOpen } from '@/composables/inbox/inboxWindow'

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
// The other inputs a template may ask for: its header value (text, a file of this conversation, or a location) and one
// value per button that takes one (a url suffix or a coupon code).
const headerParam = ref('')
const buttonValues = ref<string[]>([])
const headerLocation = ref(emptyLocationDraft())
const headerUpload = ref<{ name: string; attachment: InboxAttachment | null } | null>(null)
const headerError = ref('')
let headerSeq = 0
const highlighted = ref(0)
const suggestionsDismissed = ref(false)
const panel = ref<'location' | 'interactive' | null>(null)
const location = ref(emptyLocationDraft())
const interactive = ref(emptyInteractiveDraft())
// The file being attached: sent after the upload finishes, with the draft text as its caption.
const upload = ref<{ name: string; size: number; attachment: InboxAttachment | null } | null>(null)
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
const { mutateAsync: uploadFile } = useUploadInboxFile(conversationId)
const notifyTyping = useInboxTyping(conversationId)
const { data: canned } = useInboxCannedReplies()
const { data: templates, isLoading: templatesLoading, isError: templatesFailed, refetch: reloadTemplates } = useInboxTemplates(() => props.conversation.channel.id, templateMode)

const suggestions = computed(() => mode.value === 'reply' && windowOpen.value && !suggestionsDismissed.value ? cannedSuggestions(draft.value, canned.value?.items ?? []) : [])
const selectedTemplate = computed(() => templates.value?.items.find(item => item.id === templateId.value && item.supported))
const templateItems = computed(() => (templates.value?.items ?? []).filter(item => item.supported).map(item => ({ value: item.id, label: `${item.name} · ${item.language}`, category: item.category })))
const modeItems = computed(() => [
  { value: 'reply', label: t('inbox.composer.reply'), icon: 'i-lucide-reply' },
  { value: 'note', label: t('inbox.composer.note'), icon: 'i-lucide-lock' },
])
const headerNeeds = computed(() => selectedTemplate.value ? headerInput(selectedTemplate.value) : null)
const buttonInputs = computed(() => selectedTemplate.value ? dynamicButtons(selectedTemplate.value) : [])
const headerUploading = computed(() => !!headerUpload.value && !headerUpload.value.attachment)
const sendInput = computed(() => ({
  params: params.value,
  headerParam: headerParam.value,
  headerAttachmentId: headerUpload.value?.attachment?.id ?? null,
  headerLocation: buildLocation(headerLocation.value),
  buttonValues: buttonValues.value,
}))
const templateReady = computed(() => !!selectedTemplate.value && !headerUploading.value && templateReplyReady(selectedTemplate.value, sendInput.value))
const previewParts = computed(() => selectedTemplate.value
  ? templatePreview(selectedTemplate.value, { params: params.value, headerParam: headerParam.value, headerMediaName: headerUpload.value?.name ?? null }, t('inbox.templates.auth.copyCode'))
  : null)
const textareaLabel = computed(() => mode.value === 'note' ? t('inbox.composer.notePlaceholder') : upload.value ? t('inbox.composer.captionPlaceholder') : t('inbox.composer.placeholder'))
const uploading = computed(() => !!upload.value && !upload.value.attachment)
const captionAllowed = computed(() => !upload.value?.attachment || inboxAcceptsCaption(upload.value.attachment.mimetype))
const captionTooLong = computed(() => mode.value === 'reply' && !!upload.value && captionAllowed.value && draft.value.trim().length > INBOX_CAPTION_MAX)
const quoted = computed(() => (mode.value === 'reply' && !templateMode.value ? props.replyTo ?? null : null))
const composing = computed(() => mode.value === 'reply' && !templateMode.value)
const replyReady = computed(() => {
  if (panel.value === 'location') return !!buildLocation(location.value)
  if (panel.value === 'interactive') return !!buildInteractive(interactive.value)
  return !uploading.value && !captionTooLong.value && (!!upload.value || !!draft.value.trim())
})
const canSend = computed(() => hydrated.value && !sending.value && (templateMode.value ? templateReady.value : mode.value === 'note' ? !!draft.value.trim() : replyReady.value))

watch(draft, () => { suggestionsDismissed.value = false; highlighted.value = 0 })
// A restored draft keeps its parameters; choosing another template starts them empty.
watch(selectedTemplate, (template, previous) => {
  if (previous && previous.id !== template?.id) resetTemplateInputs()
  const count = template?.param_count ?? 0
  if (params.value.length !== count) params.value = Array.from({ length: count }, (_, index) => params.value[index] ?? '')
  const buttons = template ? dynamicButtons(template).length : 0
  if (buttonValues.value.length !== buttons) buttonValues.value = Array.from({ length: buttons }, (_, index) => buttonValues.value[index] ?? '')
})

function resetTemplateInputs() {
  params.value = []
  headerParam.value = ''
  buttonValues.value = []
  headerLocation.value = emptyLocationDraft()
  discardHeaderUpload()
}
function discardHeaderUpload() {
  headerSeq++
  headerUpload.value = null
  headerError.value = ''
}
const FAMILY = { image: (type: string) => type.startsWith('image/'), video: (type: string) => type.startsWith('video/'), document: (type: string) => !/^(image|video|audio)\//.test(type) }

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
    headerParam.value = stored.headerParam
    buttonValues.value = stored.buttonParams
    if (stored.replyTo && !props.replyTo) emit('update:replyTo', stored.replyTo)
    if (stored.location) { location.value = stored.location; panel.value = 'location' }
    if (stored.interactive) { interactive.value = stored.interactive; panel.value = 'interactive' }
  }
  hydratedDraft.value = true
})
watch([() => texts.reply, () => texts.note, templateId, params, headerParam, buttonValues, () => props.replyTo, panel, location, interactive], () => {
  if (!hydratedDraft.value || !me.value?.id) return
  inboxDrafts.set(me.value.id, props.conversation.id, {
    ...emptyInboxDraft(),
    reply: texts.reply,
    note: texts.note,
    templateId: templateId.value ?? null,
    params: [...params.value],
    headerParam: headerParam.value,
    buttonParams: [...buttonValues.value],
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
  upload.value = { name: file.name, size: file.size, attachment: null }
  try {
    const attachment = await uploadFile(file)
    if (current === uploadSeq && upload.value) upload.value.attachment = attachment
  } catch (e) {
    if (current !== uploadSeq) return
    upload.value = null
    uploadError.value = e instanceof ApiError && e.status === 413 ? t('inbox.composer.upload.tooLargeServer') : t('inbox.composer.upload.failed')
  }
}

async function onHeaderPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || headerNeeds.value?.kind !== 'media') return
  discardHeaderUpload()
  const problem = inboxUploadProblem(file)
  if (problem) {
    headerError.value = t(`inbox.composer.upload.${problem.reason}`, { name: file.name, limit: problem.reason === 'tooLarge' ? problem.limitMb : 0 })
    return
  }
  if (!FAMILY[headerNeeds.value.media](file.type)) {
    headerError.value = t(`inbox.composer.headerWrongType.${headerNeeds.value.media}`, { name: file.name })
    return
  }
  const current = ++headerSeq
  headerUpload.value = { name: file.name, attachment: null }
  try {
    const attachment = await uploadFile(file)
    if (current === headerSeq && headerUpload.value) headerUpload.value.attachment = attachment
  } catch (e) {
    if (current !== headerSeq) return
    headerUpload.value = null
    headerError.value = e instanceof ApiError && e.status === 413 ? t('inbox.composer.upload.tooLargeServer') : t('inbox.composer.upload.failed')
  }
}

function pickSuggestion(body: string) {
  draft.value = body
}
// The indicator follows real keystrokes only: restoring a draft or picking a canned reply is not typing.
const isTypingKey = (event: KeyboardEvent) => !event.ctrlKey && !event.metaKey && (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Process')
function onKeydown(event: KeyboardEvent) {
  if (composing.value && isTypingKey(event)) notifyTyping()
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
type FreeFormReply = Exclude<InboxReplyCreate, { template_id: number }>

/** The reply payload and whether it carries the typed text (a location, an interactive message or an audio file does not). */
function replyContent(): { content: FreeFormReply, usesText: boolean } {
  if (panel.value === 'location') return { content: { location: buildLocation(location.value)! }, usesText: false }
  if (panel.value === 'interactive') return { content: { interactive: buildInteractive(interactive.value)! }, usesText: false }
  const caption = draft.value.trim()
  const attachment = upload.value?.attachment
  if (!attachment) return { content: { body: caption }, usesText: true }
  const withCaption = !!caption && inboxAcceptsCaption(attachment.mimetype)
  return { content: { attachment_id: attachment.id, ...(withCaption ? { caption } : {}) }, usesText: withCaption }
}

async function submit() {
  if (!canSend.value) return
  try {
    if (templateMode.value) {
      await sendReply(buildTemplateReply(selectedTemplate.value!, sendInput.value))
      templateId.value = undefined
      resetTemplateInputs()
    } else if (mode.value === 'note') {
      await sendNote({ body: draft.value.trim() })
      texts.note = ''
    } else {
      const { content, usesText } = replyContent()
      await sendReply({ ...content, ...(props.replyTo ? { reply_to_id: props.replyTo.id } : {}) })
      // Text that was not part of the sent message stays as the draft.
      if (usesText) texts.reply = ''
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
          <USelect v-model="templateId" class="w-full" :items="templateItems" :placeholder="t('inbox.composer.pickTemplate')" :disabled="!hydrated || sending" data-testid="inbox-template-select">
            <template #item-trailing="{ item }"><SharedStatusBadge v-if="typeof item === 'object' && 'category' in item" size="sm" :tone="TEMPLATE_CATEGORY_TONE[item.category]" :label="t(`inbox.templates.category.${item.category}`)" /></template>
          </USelect>
        </UFormField>
        <div v-if="selectedTemplate" class="flex flex-col gap-2">
          <p v-if="selectedTemplate.category === 'marketing'" class="flex items-center gap-1.5 text-xs text-muted" data-testid="inbox-template-marketing-note">
            <SharedStatusBadge size="sm" :tone="TEMPLATE_CATEGORY_TONE.marketing" :label="t('inbox.templates.category.marketing')" />{{ t('inbox.composer.marketingNote') }}
          </p>
          <UFormField v-if="headerNeeds?.kind === 'text'" :label="t('inbox.composer.headerParam')" required>
            <UInput v-model="headerParam" class="w-full" maxlength="60" :disabled="!hydrated || sending" data-testid="inbox-template-header-param" />
          </UFormField>
          <div v-else-if="headerNeeds?.kind === 'media'" class="flex flex-col gap-2" data-testid="inbox-template-header-media">
            <p class="text-sm font-medium">{{ t('inbox.composer.headerMedia', { kind: t(`inbox.templates.header.${headerNeeds.media}`) }) }} <span class="text-error" aria-hidden="true">*</span></p>
            <div class="flex flex-wrap items-center gap-2">
              <SharedFileField :accept="HEADER_MEDIA_ACCEPT[headerNeeds.media]" :label="t('inbox.composer.attach')" :show-file-name="false" :disabled="!hydrated || sending || headerUploading" data-testid="inbox-template-header-file" @change="onHeaderPicked" />
              <span v-if="headerUpload" class="inline-flex min-w-0 items-center gap-1.5 text-sm"><UIcon name="i-lucide-paperclip" class="size-4 shrink-0 text-muted" aria-hidden="true" /><bdi class="truncate">{{ headerUpload.name }}</bdi><UIcon v-if="headerUploading" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-muted" aria-hidden="true" /></span>
              <UButton v-if="headerUpload" type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('inbox.composer.removeFile')" @click="discardHeaderUpload" />
            </div>
            <p v-if="headerError" class="text-sm text-error" role="alert" data-testid="inbox-template-header-error">{{ headerError }}</p>
          </div>
          <InboxLocationForm v-else-if="headerNeeds?.kind === 'location'" v-model="headerLocation" />
          <UFormField v-for="(_, index) in params" :key="index" :label="selectedTemplate.category === 'authentication' ? t('inbox.composer.code') : t('inbox.composer.param', { n: index + 1 })" required>
            <UInput v-model="params[index]" class="w-full" maxlength="1024" :disabled="!hydrated || sending" />
          </UFormField>
          <UFormField v-for="(button, position) in buttonInputs" :key="button.index" :label="button.type === 'copy_code' ? t('inbox.composer.couponCode') : t('inbox.composer.urlSuffix', { text: button.text })" required>
            <UInput v-model="buttonValues[position]" class="w-full" dir="ltr" maxlength="2000" :disabled="!hydrated || sending" :data-testid="`inbox-template-button-param-${position}`" />
          </UFormField>
          <SharedSubCard tone="tinted">
            <p class="mb-2 text-xs text-muted">{{ t('inbox.composer.preview') }}</p>
            <InboxTemplatePreview v-if="previewParts" :parts="previewParts" />
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
        <span v-if="uploading" class="inline-flex shrink-0 items-center gap-1 text-xs text-muted" role="status"><UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />{{ t('inbox.composer.uploading') }}</span>
        <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-x" :aria-label="t('inbox.composer.removeFile')" @click="discardUpload" />
      </div>
      <InboxLocationForm v-if="panel === 'location'" v-model="location" />
      <InboxInteractiveBuilder v-else-if="panel === 'interactive'" v-model="interactive" :channel-id="props.conversation.channel.id" />
      <p v-if="captionTooLong" class="text-xs text-error" role="alert" data-testid="inbox-caption-too-long">{{ t('inbox.composer.captionTooLong', { max: INBOX_CAPTION_MAX }) }}</p>
      <p v-else-if="!captionAllowed" class="text-xs text-muted" data-testid="inbox-audio-no-caption">{{ t('inbox.composer.audioNoCaption') }}</p>
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
        v-if="mode === 'note' || (!panel && captionAllowed)"
        v-model="draft"
        :rows="2"
        autoresize
        class="w-full"
        :maxrows="8"
        :maxlength="upload ? INBOX_CAPTION_MAX : 4096"
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
