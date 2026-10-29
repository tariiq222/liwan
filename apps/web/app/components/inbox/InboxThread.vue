<script setup lang="ts">
import type { InboxMessage } from '@webvue/contracts'
import { useInboxMessages, useReactToInboxMessage, useRetryInboxMessage } from '@/composables/inbox/useInbox'
import { DELIVERY_ICON, inboxDayKey } from '@/composables/inbox/inboxPresentation'
import { INBOX_REACTION_EMOJIS } from '@/composables/inbox/inboxReactions'

// The message thread of one conversation, oldest first. Inbound messages sit at the start of the line, replies at the
// end, internal notes are a full-width tinted block that is never sent to the customer. Inside the reply window an agent
// can quote a message (the `reply` event) and react to it with an emoji; the customer's reaction shows beside it.
const props = defineProps<{ conversationId: number; canReply: boolean; windowOpen: boolean }>()
const emit = defineEmits<{ reply: [target: { id: number; preview: string }] }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { items, isLoading, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useInboxMessages(() => props.conversationId)
const { mutate: retry, isPending: retrying, variables: retryingId } = useRetryInboxMessage(() => props.conversationId)
const { mutate: react } = useReactToInboxMessage(() => props.conversationId)
const scroller = ref<HTMLElement | null>(null)
const highlightedId = ref<number | null>(null)
const timeFormat = computed(() => new Intl.DateTimeFormat(locale.value, { hour: 'numeric', minute: '2-digit' }))
const dayFormat = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'long', day: 'numeric', month: 'long' }))

type Row = { kind: 'day'; key: string } | { kind: 'message'; item: InboxMessage }
const rows = computed<Row[]>(() => {
  const result: Row[] = []
  let day = ''
  for (const item of items.value) {
    const key = inboxDayKey(item.created_at)
    if (key !== day) {
      day = key
      result.push({ kind: 'day', key })
    }
    result.push({ kind: 'message', item })
  }
  return result
})

// Keep the newest message in view when one arrives, but leave the reading position alone while older ones load.
const newestId = computed(() => items.value.at(-1)?.id)
watch(newestId, async () => {
  await nextTick()
  scroller.value?.scrollTo({ top: scroller.value.scrollHeight })
}, { immediate: true, flush: 'post' })

function loadOlder() {
  void fetchNextPage()
}
function retryMessage(id: number) {
  retry(id, { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })
}
const loadedIds = computed(() => new Set(items.value.map(item => item.id)))
// Only a message WhatsApp knows can be quoted or reacted to: every inbound one, and an outbound one once sent.
const PROVIDER_STATES = new Set<InboxMessage['delivery_state']>(['received', 'sent', 'delivered', 'read'])
const canAct = (item: InboxMessage) => props.canReply && props.windowOpen && item.direction !== 'note' && PROVIDER_STATES.has(item.delivery_state)

function quote(item: InboxMessage) {
  emit('reply', { id: item.id, preview: (item.body || t(`inbox.kinds.${item.kind}`)).slice(0, 80) })
}
function pickReaction(item: InboxMessage, emoji: string) {
  react({ messageId: item.id, emoji: item.reactions.agent === emoji ? '' : emoji }, { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })
}
// The quoted message is scrolled to and flashed when it is loaded; an older one that is not loaded stays a plain quote.
function showQuoted(id: number) {
  scroller.value?.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  highlightedId.value = id
  setTimeout(() => { if (highlightedId.value === id) highlightedId.value = null }, 1600)
}
const deliveryLabel = (item: InboxMessage) => t(`inbox.delivery.${item.delivery_state}`)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SharedErrorState v-if="isError && !items.length" :error="error" class="m-4" @retry="refetch()" />
    <SharedLoadingSkeleton v-else-if="isLoading" class="m-4" />
    <SharedEmptyState v-else-if="!items.length" :title="t('inbox.thread.empty')" class="m-4" />
    <div v-else ref="scroller" class="min-h-0 flex-1 overflow-y-auto bg-(--webvue-canvas) px-4 py-2" data-testid="inbox-thread-scroller">
      <div v-if="hasNextPage" class="flex justify-center p-2">
        <UButton type="button" color="neutral" variant="ghost" size="sm" :disabled="!hydrated || isFetchingNextPage" :label="t('inbox.thread.loadOlder')" @click="loadOlder" />
      </div>
      <ol class="flex flex-col gap-1.5" :aria-label="t('inbox.thread.label')">
        <template v-for="row in rows" :key="row.kind === 'day' ? row.key : row.item.id">
          <li v-if="row.kind === 'day'" class="my-2 text-center text-xs text-muted"><time :datetime="row.key">{{ dayFormat.format(new Date(`${row.key}T12:00:00`)) }}</time></li>
          <li
            v-else
            :data-message-id="row.item.id"
            :data-direction="row.item.direction"
            class="group flex max-w-[min(100%,28rem)] flex-col gap-1"
            :class="row.item.direction === 'out' ? 'ms-auto items-end' : row.item.direction === 'in' ? 'me-auto items-start' : 'w-full max-w-none items-stretch'"
          >
            <div
              class="max-w-full rounded-control px-3 py-1.5 text-start text-sm break-words ring ring-default transition-shadow"
              :data-highlighted="highlightedId === row.item.id || undefined"
              :class="{
                'bg-default rounded-es-sm': row.item.direction === 'in',
                'bg-(--brand-soft) text-highlighted rounded-ee-sm': row.item.direction === 'out',
                'bg-warning/10 ring-warning/30': row.item.direction === 'note',
                'ring-2 ring-primary': highlightedId === row.item.id,
              }"
            >
              <p v-if="row.item.direction === 'note'" class="mb-0.5 flex items-center gap-1 text-xs font-medium text-warning">
                <UIcon name="i-lucide-lock" class="size-3.5" aria-hidden="true" />{{ t('inbox.thread.note') }}
              </p>
              <p v-if="row.item.template" class="mb-0.5 flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-file-text" class="size-3.5" aria-hidden="true" />{{ t('inbox.thread.template', { name: row.item.template.name }) }}
              </p>
              <component
                :is="loadedIds.has(row.item.reply_to.id) ? 'button' : 'div'"
                v-if="row.item.reply_to"
                :type="loadedIds.has(row.item.reply_to.id) ? 'button' : undefined"
                class="mb-1.5 flex w-full flex-col rounded-control border-s-2 border-primary bg-elevated/60 px-2 py-1 text-start text-xs"
                :class="{ 'cursor-pointer hover:bg-elevated': loadedIds.has(row.item.reply_to.id) }"
                data-testid="inbox-quote"
                @click="loadedIds.has(row.item.reply_to.id) && showQuoted(row.item.reply_to.id)"
              >
                <span class="font-medium text-primary">{{ t('inbox.thread.inReplyTo') }}</span>
                <span class="truncate text-muted">{{ row.item.reply_to.preview || t('inbox.thread.quotedMedia') }}</span>
              </component>
              <InboxMessageContent :message="row.item" />
              <p class="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted">
                <span v-if="row.item.author && row.item.direction !== 'in'">{{ row.item.author.name }}</span>
                <time :datetime="row.item.created_at">{{ timeFormat.format(new Date(row.item.created_at)) }}</time>
                <span v-if="row.item.direction === 'out'" class="inline-flex items-center gap-0.5" :class="{ 'text-error': row.item.delivery_state === 'failed', 'text-brand-link': row.item.delivery_state === 'read' }" :data-delivery="row.item.delivery_state">
                  <UIcon :name="DELIVERY_ICON[row.item.delivery_state]" class="size-3.5" aria-hidden="true" />{{ deliveryLabel(row.item) }}
                </span>
              </p>
            </div>
            <ul v-if="row.item.reactions.customer || row.item.reactions.agent" class="-mt-1 flex gap-1 px-2" :aria-label="t('inbox.thread.reactions')" data-testid="inbox-reactions">
              <li v-if="row.item.reactions.customer" class="rounded-full bg-default px-1.5 text-sm ring ring-default" :aria-label="t('inbox.thread.customerReaction', { emoji: row.item.reactions.customer })">{{ row.item.reactions.customer }}</li>
              <li v-if="row.item.reactions.agent" class="rounded-full bg-(--brand-soft) px-1.5 text-sm ring ring-default" :aria-label="t('inbox.thread.agentReaction', { emoji: row.item.reactions.agent })">{{ row.item.reactions.agent }}</li>
            </ul>
            <div v-if="canAct(row.item)" class="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
              <UButton type="button" size="xs" color="neutral" variant="ghost" icon="i-lucide-reply" :label="t('inbox.thread.reply')" :disabled="!hydrated" data-testid="inbox-reply-action" @click="quote(row.item)" />
              <UPopover>
                <UButton type="button" size="xs" color="neutral" variant="ghost" icon="i-lucide-smile-plus" :label="t('inbox.thread.react')" :disabled="!hydrated" data-testid="inbox-react-action" />
                <template #content>
                  <div class="flex gap-0.5 p-1" role="group" :aria-label="t('inbox.thread.react')">
                    <UButton
                      v-for="emoji in INBOX_REACTION_EMOJIS"
                      :key="emoji"
                      type="button"
                      size="sm"
                      color="neutral"
                      :variant="row.item.reactions.agent === emoji ? 'soft' : 'ghost'"
                      square
                      :aria-pressed="row.item.reactions.agent === emoji"
                      :aria-label="emoji"
                      @click="pickReaction(row.item, emoji)"
                    >
                      <span class="text-lg" aria-hidden="true">{{ emoji }}</span>
                    </UButton>
                  </div>
                </template>
              </UPopover>
            </div>
            <p v-if="row.item.direction === 'in' && row.item.error" class="text-xs text-error" role="alert" data-testid="inbox-inbound-error">{{ t('inbox.thread.mediaFailed') }}</p>
            <div v-if="row.item.direction === 'out' && row.item.delivery_state === 'failed'" class="flex flex-wrap items-center gap-2 text-xs text-error" role="alert">
              <span>{{ row.item.error || t('inbox.thread.failed') }}</span>
              <UButton
                v-if="props.canReply"
                type="button"
                size="xs"
                color="error"
                variant="outline"
                icon="i-lucide-rotate-ccw"
                :label="t('inbox.thread.retry')"
                :loading="retrying && retryingId === row.item.id"
                :disabled="!hydrated || retrying"
                @click="retryMessage(row.item.id)"
              />
            </div>
          </li>
        </template>
      </ol>
    </div>
  </div>
</template>
