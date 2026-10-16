<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useDeleteMeetingAttachment, useMeetingAttachments, useUploadMeetingAttachment } from '@/composables/useMeetings'

const props = defineProps<{ meetingId: number; canEdit: boolean }>()
// The record page shows the attachment count in its tab label.
const emit = defineEmits<{ count: [count: number] }>()

const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const attachments = useMeetingAttachments(() => props.meetingId)
const { mutateAsync: upload, isPending: uploading } = useUploadMeetingAttachment()
const { mutateAsync: remove, isPending: deleting } = useDeleteMeetingAttachment()
const pendingDeleteId = ref<number | null>(null)
const fileField = ref<{ reset: () => void } | null>(null)

watch(() => attachments.data.value?.items.length ?? 0, count => emit('count', count), { immediate: true })

function readAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      resolve(result.slice(result.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const data = await readAsBase64(file)
    await upload({ meetingId: props.meetingId, name: file.name, mimetype: file.type || undefined, data })
  } catch (error) {
    toast.add({ title: error instanceof ApiError || error instanceof Error ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    input.value = ''
    fileField.value?.reset()
  }
}

async function confirmDelete(attachmentId: number) {
  try {
    await remove({ meetingId: props.meetingId, attachmentId })
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    pendingDeleteId.value = null
  }
}
</script>

<template>
  <section id="meeting-attachments" aria-labelledby="meeting-attachments-title">
    <h2 id="meeting-attachments-title" class="sr-only">{{ t('meetingsUi.attachmentsTitle') }}</h2>
    <UCard class="min-w-0">
      <SharedPageState :loading="attachments.isLoading.value" :error="attachments.error.value" :empty="!attachments.data.value?.items.length" :empty-text="t('meetingsUi.emptyAttachments')" @retry="() => attachments.refetch()">
        <ul class="grid min-w-0 divide-y divide-default">
          <li v-for="attachment in attachments.data.value?.items" :key="attachment.id" class="flex min-w-0 flex-wrap items-center gap-2 py-2">
            <UButton color="primary" variant="link" class="min-w-0 flex-1 justify-start p-0" :to="attachment.url" external target="_blank" rel="noopener" :label="attachment.name" />
            <UButton v-if="canEdit && pendingDeleteId !== attachment.id" type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('attachments.delete')" :disabled="!hydrated || deleting || pendingDeleteId !== null" @click="pendingDeleteId = attachment.id" />
            <SharedInlineConfirm
              v-if="pendingDeleteId === attachment.id"
              class="basis-full"
              color="error"
              :title="t('attachments.deleteConfirm')"
              :confirm-label="t('attachments.confirm')"
              :cancel-label="t('attachments.cancel')"
              :pending="deleting"
              @cancel="pendingDeleteId = null"
              @confirm="confirmDelete(attachment.id)"
            />
          </li>
        </ul>
      </SharedPageState>
      <div v-if="canEdit" class="mt-4 grid min-w-0 gap-2 border-t border-default pt-4">
        <label for="meeting-attachment-upload" class="text-sm font-medium text-highlighted">{{ t('meetingsUi.uploadAttachment') }}</label>
        <SharedFileField id="meeting-attachment-upload" ref="fileField" class="w-full" :disabled="!hydrated || uploading" @change="onFileChange" />
        <p class="text-xs text-muted">{{ t('meetingsUi.attachmentHelp') }}</p>
      </div>
    </UCard>
  </section>
</template>
