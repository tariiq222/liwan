<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useDeleteTaskAttachment, useTaskAttachments, useUploadTaskAttachment } from '@/composables/useTaskAttachments'

const props = defineProps<{ taskId: number; canWrite: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const uploadError = ref('')
const pendingDeleteId = ref<number | null>(null)
const fileField = ref<{ reset: () => void } | null>(null)
const { data, isLoading, error, refetch } = useTaskAttachments(() => props.taskId)
const { mutateAsync: upload, isPending: uploading } = useUploadTaskAttachment()
const { mutateAsync: remove, isPending: deleting } = useDeleteTaskAttachment()

const MAX_BYTES = 10 * 1024 * 1024

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  uploadError.value = ''
  try {
    if (file.size > MAX_BYTES) throw new Error(t('attachments.errors.tooLarge'))
    const data = await readFileAsBase64(file)
    await upload({ taskId: props.taskId, name: file.name, mimetype: file.type || undefined, data })
    emit('changed')
  } catch (error) {
    uploadError.value = error instanceof ApiError || error instanceof Error ? error.message : t('errors.generic')
    toast.add({ title: uploadError.value, color: 'error' })
  } finally {
    // Clearing the input allows choosing the same file again after an error or
    // after replacing a deleted attachment.
    input.value = ''
    fileField.value?.reset()
  }
}

function requestDelete(id: number) {
  if (!hydrated.value || deleting.value) return
  pendingDeleteId.value = id
}

function cancelDelete() {
  if (deleting.value) return
  pendingDeleteId.value = null
}

async function confirmDelete(id: number) {
  if (pendingDeleteId.value !== id || deleting.value) return
  try {
    await remove({ taskId: props.taskId, attachmentId: id })
    emit('changed')
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  } finally {
    pendingDeleteId.value = null
  }
}
</script>

<template>
  <section data-testid="task-attachments" class="space-y-3">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-highlighted">{{ t('attachments.title') }}</h2>
      <span v-if="data" class="text-xs text-muted">{{ data.items.length }}</span>
    </header>

    <div class="space-y-3">
      <p v-if="isLoading" class="py-2 text-sm text-muted">{{ t('attachments.loading') }}</p>
      <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
      <p v-else-if="!data?.items.length" class="py-2 text-sm text-muted">{{ t('attachments.empty') }}</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="attachment in data.items" :key="attachment.id" class="grid min-w-0 gap-2 py-2 text-sm">
          <div class="flex items-center gap-2">
            <a :href="attachment.url" target="_blank" rel="noopener" class="min-w-0 flex-1 truncate text-brand-link underline">
              {{ attachment.name }}
            </a>
            <UButton
              v-if="props.canWrite && pendingDeleteId !== attachment.id"
              type="button"
              variant="ghost"
              size="sm"
              color="error"
              square
              icon="i-lucide-trash-2"
              :aria-label="t('attachments.delete')"
              :disabled="!hydrated || deleting || pendingDeleteId !== null"
              @click="requestDelete(attachment.id)"
            />
          </div>
          <div v-if="pendingDeleteId === attachment.id" role="group" :aria-label="t('attachments.deleteConfirm')">
            <SharedInlineConfirm
              :title="t('attachments.deleteConfirm')"
              :confirm-label="t('attachments.confirm')"
              :cancel-label="t('attachments.cancel')"
              :pending="deleting"
              @confirm="confirmDelete(attachment.id)"
              @cancel="cancelDelete"
            />
          </div>
        </li>
      </ul>

      <div v-if="props.canWrite" class="grid gap-2">
        <label for="task-attachment-upload">{{ t('attachments.upload') }}</label>
        <SharedFileField
          ref="fileField"
          id="task-attachment-upload"
          accept=".txt,.pdf,.png,.jpg,.jpeg,.docx,.xlsx,text/plain,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="w-full min-w-0"
          :disabled="!hydrated || uploading"
          @change="onFileChange"
        />
        <p class="text-xs text-muted">{{ t('attachments.help') }}</p>
        <p v-if="uploadError" role="alert" class="text-sm text-error">{{ uploadError }}</p>
      </div>
    </div>
  </section>
</template>
