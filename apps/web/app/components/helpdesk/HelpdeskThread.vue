<script setup lang="ts">
import type { HelpdeskAttachment } from '@liwan/contracts'
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { useHelpdeskAttachments, useHelpdeskComment, useHelpdeskMessages } from '@/composables/helpdesk/useHelpdesk'

// The conversation of one ticket: the public replies and the internal notes in date order, a composer that sends either
// (agents only for the note), and the attachments with their upload and download. The requester may answer their own
// ticket; the server decides that again.
const props = defineProps<{ ticketId: number; attachments: HelpdeskAttachment[]; closed: boolean; canWrite: boolean; canRequest: boolean }>()
const { t } = useI18n()
// Nothing is typed into a field the server rendered a different value for: the composer opens once the page is
// hydrated, the same rule every other form in the product follows.
const hydrated = useHydrated()
const messages = useHelpdeskMessages(() => props.ticketId)
const comment = useHelpdeskComment()
const files = useHelpdeskAttachments(() => props.ticketId)
const body = ref('')
const internal = ref(false)
const failure = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const items = computed(() => messages.data.value?.items ?? [])
const mayComment = computed(() => props.canWrite || props.canRequest)

async function send() {
  const text = body.value.trim()
  if (!text || comment.isPending.value) return
  failure.value = null
  try {
    await comment.mutateAsync({ id: props.ticketId, body: text, internal: internal.value })
    body.value = ''
    internal.value = false
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.thread.failed')
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.readAsDataURL(file)
  })
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  failure.value = null
  try {
    await files.upload.mutateAsync({ name: file.name, mimetype: file.type || 'application/octet-stream', data: await readFile(file) })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.thread.uploadFailed')
  }
}

async function removeAttachment(id: number) {
  failure.value = null
  try {
    await files.remove.mutateAsync(id)
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.thread.deleteFailed')
  }
}
const downloadUrl = (attachment: HelpdeskAttachment) => `/api/v1/helpdesk/tickets/${props.ticketId}/attachments/${attachment.id}/download`
const busy = computed(() => files.upload.isPending.value || files.remove.isPending.value)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <SharedRecordSection variant="panel" :title="t('helpdesk.thread.title')" data-testid="helpdesk-thread">
      <SharedEmptyState v-if="!items.length" :title="t('helpdesk.thread.empty')" />
      <ul v-else class="flex flex-col gap-3">
        <li v-for="message in items" :key="message.id" class="rounded-control border border-default px-3 py-2" :class="{ 'bg-elevated': message.internal }" :data-testid="`helpdesk-message-${message.id}`">
          <div class="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span class="font-medium text-highlighted">{{ message.author }}</span>
            <bdi dir="ltr">{{ formatDate(message.created_at) }}</bdi>
            <SharedStatusBadge v-if="message.internal" tone="warning" :label="t('helpdesk.thread.internal')" size="sm" />
          </div>
          <!-- The server stores HTML; the shared renderer sanitizes it again and owns its typography. -->
          <SharedRichText :html="message.body" size="sm" />
        </li>
      </ul>
      <template v-if="mayComment">
        <div class="mt-4 flex flex-col gap-2">
          <UTextarea v-model="body" class="w-full" :rows="3" :disabled="comment.isPending.value || !hydrated" :placeholder="t('helpdesk.thread.placeholder')" data-testid="helpdesk-comment" />
          <div class="flex flex-wrap items-center justify-between gap-2">
            <UCheckbox v-if="canWrite" v-model="internal" :disabled="!hydrated" :label="t('helpdesk.thread.note')" data-testid="helpdesk-note" />
            <UButton :loading="comment.isPending.value" :disabled="!hydrated || !body.trim()" :label="t('helpdesk.thread.send')" data-testid="helpdesk-comment-send" @click="send" />
          </div>
        </div>
      </template>
      <p v-if="failure" class="mt-2 text-sm text-error" role="alert" data-testid="helpdesk-thread-error">{{ failure }}</p>
    </SharedRecordSection>
    <SharedRecordSection variant="panel" :title="t('helpdesk.attachments.title')" data-testid="helpdesk-attachments">
      <SharedEmptyState v-if="!attachments.length" :title="t('helpdesk.attachments.empty')" />
      <ul v-else class="flex flex-col divide-y divide-default">
        <li v-for="attachment in attachments" :key="attachment.id" class="flex items-center justify-between gap-3 py-2">
          <a :href="downloadUrl(attachment)" class="min-w-0 truncate text-sm font-medium text-highlighted hover:underline" :data-testid="`helpdesk-attachment-${attachment.id}`">{{ attachment.name }}</a>
          <UButton v-if="mayComment" color="neutral" variant="ghost" icon="i-lucide-trash-2" size="xs" :aria-label="t('helpdesk.attachments.remove')" :disabled="busy" @click="removeAttachment(attachment.id)" />
        </li>
      </ul>
      <template v-if="mayComment">
        <input ref="fileInput" type="file" class="hidden" data-testid="helpdesk-file" @change="upload">
        <UButton class="mt-3" color="neutral" variant="outline" icon="i-lucide-paperclip" :loading="busy" :disabled="closed" :label="t('helpdesk.attachments.add')" @click="fileInput?.click()" />
      </template>
    </SharedRecordSection>
  </div>
</template>
