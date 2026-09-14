<script setup lang="ts">
import { ChatMessageListSchema, type ChatMessage } from '@nasq/contracts'
import ChatAttachment from '@/components/chat/ChatAttachment.vue'
import { ApiError } from '@/composables/useApi'
import {
  CHAT_PAGE_SIZE,
  CHAT_POLL_MS,
  CHAT_REACTIONS,
  initialsFor,
  isFatalChatStatus,
  mergeMessages,
  messageDayKey,
  needsMessageCatchUp,
  visibleReadMessageId,
} from '@/utils/chatState'

const props = defineProps<{
  conversationId: number
  pendingBody?: string
  denied?: boolean
  peerSeenMessageId?: number | null
  direct?: boolean
  q?: string
}>()
const emit = defineEmits<{ denied: []; reply: [ChatMessage] }>()
const { t, locale } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const toast = useToast()
const { $api } = useApi()
const { connected } = useBus()
const { data, isFetching, isError, error } = useChatMessages(() => props.conversationId, {}, () => props.q || '')
const { mutateAsync: markRead } = useMarkChatRead(() => props.conversationId)
const { mutateAsync: patchMessage } = usePatchChatMessage(() => props.conversationId)
const { mutateAsync: reactMessage } = useReactChatMessage(() => props.conversationId)
const { mutateAsync: pinMessage } = usePinChatMessage(() => props.conversationId)
const { mutateAsync: starMessage } = useStarChatMessage(() => props.conversationId)
const editingId = ref<number | null>(null)
const editDraft = ref('')
const confirmingDelete = ref<number | null>(null)
const busyId = ref<number | null>(null)
const items = ref<ChatMessage[]>([])
const scroller = ref<HTMLElement | null>(null)
const stickToEnd = ref(true)
const loadingOlder = ref(false)
const jumpCount = ref(0)
const sealed = ref(false)
let pollTimer: ReturnType<typeof setInterval> | undefined

const timeFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', calendar: 'gregory' }))
const dayFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', calendar: 'gregory' }))

const rows = computed(() => {
  const out: Array<{ kind: 'day'; key: string } | { kind: 'message'; item: ChatMessage }> = []
  let lastDay = ''
  for (const item of items.value) {
    const day = messageDayKey(item.created_at)
    if (day !== lastDay) {
      out.push({ kind: 'day', key: day })
      lastDay = day
    }
    out.push({ kind: 'message', item })
  }
  return out
})

watch(() => [props.conversationId, props.q], () => {
  items.value = []
  stickToEnd.value = true
  jumpCount.value = 0
  sealed.value = false
  editingId.value = null
  confirmingDelete.value = null
})

watch(() => data.value?.items, async (incoming) => {
  if (!incoming || sealed.value) return
  const mode = items.value.length ? 'newer' : 'replace'
  const previousHeight = scroller.value?.scrollHeight ?? 0
  const previousTop = scroller.value?.scrollTop ?? 0
  items.value = mergeMessages(items.value, incoming, mode)
  await nextTick()
  if (!scroller.value) return
  if (mode === 'replace' || stickToEnd.value) {
    scroller.value.scrollTop = scroller.value.scrollHeight
  } else {
    scroller.value.scrollTop = previousTop + (scroller.value.scrollHeight - previousHeight)
  }
  if (mode === 'replace') void maybeMarkRead()
})

watch(error, (value) => {
  if (value instanceof ApiError && isFatalChatStatus(value.status)) seal()
})

function seal() {
  sealed.value = true
  items.value = []
  jumpCount.value = 0
  stopPoll()
  emit('denied')
}

function onScroll() {
  if (!scroller.value) return
  const remaining = scroller.value.scrollHeight - scroller.value.scrollTop - scroller.value.clientHeight
  stickToEnd.value = remaining < 48
  if (stickToEnd.value) jumpCount.value = 0
  void maybeMarkRead()
}

async function restoreScroll(kind: 'older' | 'bottom') {
  await nextTick()
  if (!scroller.value) return
  if (kind === 'bottom') scroller.value.scrollTop = scroller.value.scrollHeight
}

async function loadOlder() {
  const oldest = items.value[0]
  if (!oldest || loadingOlder.value || sealed.value) return
  loadingOlder.value = true
  const previousHeight = scroller.value?.scrollHeight ?? 0
  try {
    const page = await $api(`/api/v1/chat/conversations/${props.conversationId}/messages`, {
      query: { limit: CHAT_PAGE_SIZE, before: oldest.id, q: props.q || undefined },
      schema: ChatMessageListSchema,
    })
    items.value = mergeMessages(items.value, page.items, 'older')
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight - previousHeight
  } catch (value) {
    if (value instanceof ApiError && isFatalChatStatus(value.status)) seal()
  } finally {
    loadingOlder.value = false
  }
}

async function pollNewer() {
  if (sealed.value || props.denied || document.visibilityState !== 'visible') return
  const last = items.value.at(-1)?.id
  if (!last) return
  try {
    let after = last
    const beforeCount = items.value.length
    for (;;) {
      const page = await $api(`/api/v1/chat/conversations/${props.conversationId}/messages`, {
          query: { limit: CHAT_PAGE_SIZE, after, q: props.q || undefined },
        schema: ChatMessageListSchema,
      })
      items.value = mergeMessages(items.value, page.items, 'newer')
      if (!needsMessageCatchUp(after, page.items)) break
      const next = page.items.at(-1)?.id
      if (!next || next === after) break
      after = next
    }
    const added = items.value.length - beforeCount
    if (added && !stickToEnd.value) jumpCount.value += added
    else if (stickToEnd.value) await restoreScroll('bottom')
    if (added) void maybeMarkRead()
  } catch (value) {
    if (value instanceof ApiError && isFatalChatStatus(value.status)) seal()
  }
}

function visibleIds(): number[] {
  if (!scroller.value) return []
  const root = scroller.value.getBoundingClientRect()
  const ids: number[] = []
  for (const node of scroller.value.querySelectorAll('[data-message-id]')) {
    const box = node.getBoundingClientRect()
    if (box.bottom > root.top && box.top < root.bottom) {
      const id = Number((node as HTMLElement).dataset.messageId)
      if (Number.isInteger(id)) ids.push(id)
    }
  }
  return ids
}

async function maybeMarkRead() {
  if (sealed.value || !import.meta.client) return
  await nextTick()
  const target = visibleReadMessageId({
    tabVisible: typeof document !== 'undefined' && document.visibilityState === 'visible',
    pageVisible: typeof document !== 'undefined' && document.hasFocus(),
    visibleIds: visibleIds(),
  })
  if (!target) return
  try {
    await markRead(target)
  } catch (value) {
    if (value instanceof ApiError && isFatalChatStatus(value.status)) seal()
  }
}

function jumpToLatest() {
  stickToEnd.value = true
  jumpCount.value = 0
  void restoreScroll('bottom')
  void maybeMarkRead()
}

function startPoll() {
  stopPoll()
  if (connected.value) return
  pollTimer = setInterval(() => { void pollNewer() }, CHAT_POLL_MS)
}

watch(connected, () => {
  if (connected.value) stopPoll()
  else startPoll()
})

async function applyMessage(next: ChatMessage) {
  items.value = items.value.map(item => item.id === next.id ? next : item)
}

async function runMessageAction(item: ChatMessage, work: () => Promise<ChatMessage>) {
  if (busyId.value) return false
  busyId.value = item.id
  try {
    await applyMessage(await work())
    return true
  } catch (value) {
    if (value instanceof ApiError && isFatalChatStatus(value.status)) seal()
    else toast.add({ title: value instanceof ApiError ? value.message : t('chat.actionFailed'), color: 'error' })
    return false
  } finally {
    busyId.value = null
  }
}

async function saveEdit(item: ChatMessage) {
  if (await runMessageAction(item, () => patchMessage({ messageId: item.id, body: editDraft.value }))) {
    editingId.value = null
  }
}

async function deleteMessage(item: ChatMessage) {
  await runMessageAction(item, () => patchMessage({ messageId: item.id, body: '' }))
  confirmingDelete.value = null
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = undefined
}

function onVisibility() {
  if (document.visibilityState === 'hidden') return
  void maybeMarkRead()
}

onMounted(() => {
  startPoll()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('focus', onVisibility)
})
onUnmounted(() => {
  stopPoll()
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('focus', onVisibility)
})

watch(() => props.denied, (value) => { if (value) seal() })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex justify-center p-2">
      <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="!hydrated || isFetching || loadingOlder || !items.length || sealed" :label="t('chat.loadOlder')" @click="loadOlder" />
    </div>
    <div v-if="(isError || sealed) && !items.length" class="p-4 text-sm text-error" role="alert">{{ t('chat.unavailable') }}</div>
    <div ref="scroller" class="nasq-chat-scroller min-h-0 flex-1 overflow-y-auto px-4 py-2" data-testid="chat-scroller" @scroll="onScroll">
      <ol class="flex flex-col gap-1">
        <template v-for="row in rows" :key="row.kind === 'day' ? row.key : row.item.id">
          <li v-if="row.kind === 'day'" class="nasq-chat-day">{{ dayFmt.format(new Date(`${row.key}T00:00:00Z`)) }}</li>
          <li
            v-else
            :data-message-id="row.item.id"
            class="nasq-chat-row flex max-w-[min(100%,28rem)] flex-col gap-1"
            :class="row.item.author.id === me?.id ? 'ms-auto items-end' : 'me-auto items-start'"
          >
            <span v-if="!direct && row.item.author.id !== me?.id" class="flex items-center gap-2 px-1 text-xs font-medium text-muted">
              <span class="nasq-chat-avatar nasq-chat-avatar-sm">{{ initialsFor(row.item.author.name) }}</span>
              <span>{{ row.item.author.name }}</span>
            </span>
            <div
              class="nasq-chat-bubble max-w-full text-start text-sm whitespace-pre-wrap break-words"
              :data-out="row.item.author.id === me?.id"
            >
              <p v-if="row.item.parent" class="mb-1 border-s-2 ps-2 text-xs opacity-80">{{ row.item.parent.author.name }}: {{ row.item.parent.body }}</p>
              <template v-if="editingId === row.item.id">
                <UTextarea v-model="editDraft" :rows="2" class="w-full" />
                <div class="mt-1 flex gap-1">
                  <UButton type="button" size="sm" :disabled="busyId === row.item.id" :label="t('chat.save')" @click="saveEdit(row.item)" />
                  <UButton type="button" size="sm" color="neutral" variant="ghost" :label="t('app.cancel')" @click="editingId = null" />
                </div>
              </template>
              <template v-else>
                {{ row.item.body }}
                <span v-if="row.item.edited" class="ms-1 text-xs opacity-70">{{ t('chat.edited') }}</span>
                <span v-if="row.item.pinned" class="ms-1 text-xs opacity-70">{{ t('chat.pinned') }}</span>
              </template>
              <div v-if="row.item.attachments.length" class="mt-2 flex flex-col gap-1">
                <ChatAttachment v-for="attachment in row.item.attachments" :key="attachment.id" :attachment="attachment" />
              </div>
              <div v-if="row.item.reactions.length" class="mt-1 flex flex-wrap gap-1">
                <UButton
                  v-for="reaction in row.item.reactions"
                  :key="reaction.content"
                  type="button"
                  color="neutral"
                  :variant="reaction.me ? 'soft' : 'ghost'"
                  size="xs"
                  :aria-pressed="reaction.me"
                  :disabled="busyId === row.item.id"
                  @click="runMessageAction(row.item, () => reactMessage({ messageId: row.item.id, content: reaction.content, action: reaction.me ? 'remove' : 'add' }))"
                  :label="`${reaction.content} ${reaction.count}`"
                />
              </div>
              <p class="nasq-chat-bubble-meta">
                <time>{{ timeFmt.format(new Date(row.item.created_at)) }}</time>
                <span v-if="row.item.author.id === me?.id">{{ direct && peerSeenMessageId && row.item.id <= peerSeenMessageId ? t('chat.seen') : t('chat.sent') }}</span>
              </p>
            </div>
            <div class="nasq-chat-msg-actions flex flex-wrap gap-1 text-xs text-muted">
              <UButton type="button" color="neutral" variant="ghost" size="xs" :disabled="busyId === row.item.id" :label="t('chat.reply')" @click="emit('reply', row.item)" />
              <UButton
                v-for="emoji in CHAT_REACTIONS"
                :key="emoji"
                type="button"
                color="neutral" variant="ghost"
                :disabled="busyId === row.item.id"
                @click="runMessageAction(row.item, () => reactMessage({ messageId: row.item.id, content: emoji, action: 'add' }))"
                :label="emoji"
              />
              <UButton type="button" color="neutral" variant="ghost" size="xs" :disabled="busyId === row.item.id" :label="t('chat.star')" @click="runMessageAction(row.item, () => starMessage(row.item.id))" />
              <UButton type="button" color="neutral" variant="ghost" size="xs" :disabled="busyId === row.item.id" :label="row.item.pinned ? t('chat.unpin') : t('chat.pin')" @click="runMessageAction(row.item, () => pinMessage({ messageId: row.item.id, pinned: !row.item.pinned }))" />
              <template v-if="row.item.author.id === me?.id">
                <UButton type="button" color="neutral" variant="ghost" size="xs" :disabled="busyId === row.item.id" :label="t('chat.edit')" @click="editingId = row.item.id; editDraft = row.item.body" />
                <UButton type="button" color="error" variant="ghost" size="xs" :disabled="busyId === row.item.id || confirmingDelete === row.item.id" :label="t('chat.delete')" @click="confirmingDelete = row.item.id" />
              </template>
            </div>
            <SharedInlineConfirm
              v-if="confirmingDelete === row.item.id"
              class="w-full"
              :title="t('chat.deleteConfirmTitle')"
              :confirm-label="t('chat.confirmDelete')"
              :pending="busyId === row.item.id"
              @confirm="deleteMessage(row.item)"
              @cancel="confirmingDelete = null"
            />
          </li>
        </template>
        <li v-if="pendingBody" class="ms-auto flex max-w-[min(100%,24rem)] flex-col items-end gap-1" data-testid="chat-pending">
          <div class="nasq-chat-bubble max-w-full text-start text-sm whitespace-pre-wrap break-words" data-out="true">{{ pendingBody }}</div>
          <p class="text-xs text-muted">{{ t('chat.pending') }}</p>
        </li>
      </ol>
    </div>
    <div v-if="jumpCount" class="flex justify-center p-2">
      <UButton type="button" size="sm" :disabled="!hydrated" data-testid="chat-jump-latest" :label="t('chat.jumpLatest', { count: jumpCount })" @click="jumpToLatest" />
    </div>
  </div>
</template>
