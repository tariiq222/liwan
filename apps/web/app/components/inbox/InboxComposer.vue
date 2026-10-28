<script setup lang="ts">
import type { InboxConversationDetail } from '@webvue/contracts'
import { useInboxCannedReplies, useInboxTemplates, useSendInboxNote, useSendInboxReply } from '@/composables/inbox/useInbox'
import { inboxDrafts } from '@/composables/inbox/inboxDrafts'
import { cannedSuggestions, renderTemplateBody, replyWindowOpen } from '@/composables/inbox/inboxWindow'

// Three ways to write: a free-text reply (inside the 24-hour customer-service window), an approved template with its
// parameters (the only reply after the window), and an internal note the customer never sees. Typing "/" at the start
// of a reply suggests canned replies.
const props = defineProps<{ conversation: InboxConversationDetail }>()
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
const canSend = computed(() => hydrated.value && !sending.value && (templateMode.value ? !!selectedTemplate.value && paramsFilled.value : !!draft.value.trim()))

watch(draft, () => { suggestionsDismissed.value = false; highlighted.value = 0 })
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
  }
  hydratedDraft.value = true
})
watch([() => texts.reply, () => texts.note, templateId, params], () => {
  if (!hydratedDraft.value || !me.value?.id) return
  inboxDrafts.set(me.value.id, props.conversation.id, { reply: texts.reply, note: texts.note, templateId: templateId.value ?? null, params: [...params.value] })
}, { deep: true })

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
      await sendReply({ body: draft.value.trim() })
      texts.reply = ''
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
        :aria-label="mode === 'note' ? t('inbox.composer.notePlaceholder') : t('inbox.composer.placeholder')"
        :placeholder="mode === 'note' ? t('inbox.composer.notePlaceholder') : t('inbox.composer.placeholder')"
        :disabled="!hydrated || sending"
        @keydown="onKeydown"
      />
    </template>
    <div v-if="!templateMode || selectedTemplate" class="flex items-center justify-between gap-2">
      <p v-if="mode === 'reply' && !templateMode" class="text-xs text-muted">{{ t('inbox.composer.cannedHint') }}</p>
      <p v-else-if="mode === 'note'" class="text-xs text-muted">{{ t('inbox.composer.noteHint') }}</p>
      <span v-else />
      <UButton type="submit" :disabled="!canSend" :loading="sending" :label="mode === 'note' ? t('inbox.composer.saveNote') : t('inbox.composer.send')" />
    </div>
  </form>
</template>
