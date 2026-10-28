<script setup lang="ts">
import type { InboxMessage } from '@webvue/contracts'
import { useInboxMessages, useRetryInboxMessage } from '@/composables/inbox/useInbox'
import { DELIVERY_ICON, inboxDayKey } from '@/composables/inbox/inboxPresentation'

// The message thread of one conversation, oldest first. Inbound messages sit at the start of the line, replies at the
// end, internal notes are a full-width tinted block that is never sent to the customer.
const props = defineProps<{ conversationId: number; canReply: boolean }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { items, isLoading, isError, error, refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = useInboxMessages(() => props.conversationId)
const { mutate: retry, isPending: retrying, variables: retryingId } = useRetryInboxMessage(() => props.conversationId)
const scroller = ref<HTMLElement | null>(null)
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
const deliveryLabel = (item: InboxMessage) => t(`inbox.delivery.${item.delivery_state}`)
const downloadUrl = (message: InboxMessage, attachmentId: number) => `/api/v1/inbox/messages/${message.id}/attachments/${attachmentId}/download`
const fileSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
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
            class="flex max-w-[min(100%,28rem)] flex-col gap-1"
            :class="row.item.direction === 'out' ? 'ms-auto items-end' : row.item.direction === 'in' ? 'me-auto items-start' : 'w-full max-w-none items-stretch'"
          >
            <div
              class="max-w-full rounded-control px-3 py-1.5 text-start text-sm break-words whitespace-pre-wrap ring ring-default"
              :class="{
                'bg-default rounded-es-sm': row.item.direction === 'in',
                'bg-(--brand-soft) text-highlighted rounded-ee-sm': row.item.direction === 'out',
                'bg-warning/10 ring-warning/30': row.item.direction === 'note',
              }"
            >
              <p v-if="row.item.direction === 'note'" class="mb-0.5 flex items-center gap-1 text-xs font-medium text-warning">
                <UIcon name="i-lucide-lock" class="size-3.5" aria-hidden="true" />{{ t('inbox.thread.note') }}
              </p>
              <p v-if="row.item.template_name" class="mb-0.5 flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-file-text" class="size-3.5" aria-hidden="true" />{{ t('inbox.thread.template', { name: row.item.template_name }) }}
              </p>
              {{ row.item.body }}
              <div v-if="row.item.attachments.length" class="mt-2 flex flex-col gap-1">
                <a
                  v-for="attachment in row.item.attachments"
                  :key="attachment.id"
                  :href="downloadUrl(row.item, attachment.id)"
                  :download="attachment.name"
                  class="inline-flex min-h-8 items-center gap-2 rounded-control bg-default px-2 py-1 text-sm ring ring-default hover:bg-elevated"
                >
                  <UIcon name="i-lucide-paperclip" class="size-4 shrink-0" aria-hidden="true" />
                  <span class="min-w-0 truncate">{{ attachment.name }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ fileSize(attachment.size) }}</span>
                </a>
              </div>
              <p class="mt-1 flex items-center justify-end gap-1.5 text-xs text-muted">
                <span v-if="row.item.author && row.item.direction !== 'in'">{{ row.item.author.name }}</span>
                <time :datetime="row.item.created_at">{{ timeFormat.format(new Date(row.item.created_at)) }}</time>
                <span v-if="row.item.direction === 'out'" class="inline-flex items-center gap-0.5" :class="{ 'text-error': row.item.delivery_state === 'failed', 'text-brand-link': row.item.delivery_state === 'read' }" :data-delivery="row.item.delivery_state">
                  <UIcon :name="DELIVERY_ICON[row.item.delivery_state]" class="size-3.5" aria-hidden="true" />{{ deliveryLabel(row.item) }}
                </span>
              </p>
            </div>
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
