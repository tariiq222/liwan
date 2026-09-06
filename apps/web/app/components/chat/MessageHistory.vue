<script setup lang="ts">
import { ChatMessageListSchema, type ChatMessage } from '@nasq/contracts'
import ChatAttachment from '@/components/chat/ChatAttachment.vue'
import { ApiError } from '@/composables/useApi'
import {
  CHAT_PAGE_SIZE,
  CHAT_POLL_MS,
  initialsFor,
  isFatalChatStatus,
  mergeMessages,
  messageDayKey,
  needsMessageCatchUp,
  visibleReadMessageId,
} from '@/utils/chatState'

const props = defineProps<{ conversationId: number; pendingBody?: string; denied?: boolean }>()
const emit = defineEmits<{ denied: [] }>()
const { t, locale } = useI18n()
const { me } = useMe()
const hydrated = useHydrated()
const { $api } = useApi()
const { data, isFetching, isError, error } = useChatMessages(() => props.conversationId)
const { mutateAsync: markRead } = useMarkChatRead(() => props.conversationId)
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

watch(() => props.conversationId, () => {
  items.value = []
  stickToEnd.value = true
  jumpCount.value = 0
  sealed.value = false
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
      query: { limit: CHAT_PAGE_SIZE, before: oldest.id },
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
        query: { limit: CHAT_PAGE_SIZE, after },
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
  pollTimer = setInterval(() => { void pollNewer() }, CHAT_POLL_MS)
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
      <Button type="button" variant="ghost" size="sm" :disabled="!hydrated || isFetching || loadingOlder || !items.length || sealed" @click="loadOlder">
        {{ t('chat.loadOlder') }}
      </Button>
    </div>
    <div v-if="(isError || sealed) && !items.length" class="p-4 text-sm text-destructive" role="alert">{{ t('chat.unavailable') }}</div>
    <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto px-4 py-2" data-testid="chat-scroller" @scroll="onScroll">
      <ol class="flex flex-col gap-2">
        <template v-for="row in rows" :key="row.kind === 'day' ? row.key : row.item.id">
          <li v-if="row.kind === 'day'" class="py-2 text-center text-xs text-muted-foreground">{{ dayFmt.format(new Date(`${row.key}T00:00:00Z`)) }}</li>
          <li
            v-else
            :data-message-id="row.item.id"
            class="flex max-w-[min(100%,24rem)] flex-col gap-1"
            :class="row.item.author.id === me?.id ? 'ms-auto items-end' : 'me-auto items-start'"
          >
            <span class="flex items-center gap-2 text-xs text-muted-foreground">
              <span class="grid size-6 place-items-center rounded-full bg-muted text-[10px] font-semibold">{{ initialsFor(row.item.author.name) }}</span>
              <span>{{ row.item.author.name }}</span>
              <time>{{ timeFmt.format(new Date(row.item.created_at)) }}</time>
            </span>
            <div
              class="max-w-full rounded-2xl px-3 py-2 text-start text-sm whitespace-pre-wrap break-words"
              :class="row.item.author.id === me?.id ? 'bg-primary text-primary-foreground' : 'bg-muted'"
            >
              {{ row.item.body }}
              <div v-if="row.item.attachments.length" class="mt-2 flex flex-col gap-1">
                <ChatAttachment v-for="attachment in row.item.attachments" :key="attachment.id" :attachment="attachment" />
              </div>
              <p v-if="row.item.author.id === me?.id" class="mt-1 text-[10px] opacity-80">{{ t('chat.sent') }}</p>
            </div>
          </li>
        </template>
        <li v-if="pendingBody" class="ms-auto flex max-w-[min(100%,24rem)] flex-col items-end gap-1" data-testid="chat-pending">
          <div class="rounded-2xl bg-primary/70 px-3 py-2 text-sm text-primary-foreground">{{ pendingBody }}</div>
          <p class="text-[10px] text-muted-foreground">{{ t('chat.pending') }}</p>
        </li>
      </ol>
    </div>
    <div v-if="jumpCount" class="flex justify-center p-2">
      <Button type="button" size="sm" :disabled="!hydrated" data-testid="chat-jump-latest" @click="jumpToLatest">
        {{ t('chat.jumpLatest', { count: jumpCount }) }}
      </Button>
    </div>
  </div>
</template>
