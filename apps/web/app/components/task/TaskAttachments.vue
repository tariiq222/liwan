<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useDeleteTaskAttachment, useTaskAttachments, useUploadTaskAttachment } from '@/composables/useTaskAttachments'

const props = defineProps<{ taskId: number; canWrite: boolean }>()
const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const uploadError = ref('')
const pendingDeleteId = ref<number | null>(null)
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
    toast.error(uploadError.value)
  } finally {
    // Clearing the input allows choosing the same file again after an error or
    // after replacing a deleted attachment.
    input.value = ''
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
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  } finally {
    pendingDeleteId.value = null
  }
}
</script>

<template>
  <section data-testid="task-attachments" class="nasq-panel">
    <header class="nasq-panel-header">
      <h2>{{ t('attachments.title') }}</h2>
      <span v-if="data" class="text-xs text-muted-foreground">{{ data.items.length }}</span>
    </header>

    <div class="nasq-panel-body">
      <p v-if="isLoading" class="task-empty-inline">{{ t('attachments.loading') }}</p>
      <SharedPageState v-else-if="error" :error="error" @retry="refetch" />
      <p v-else-if="!data?.items.length" class="task-empty-inline">{{ t('attachments.empty') }}</p>
      <ul v-else class="task-list">
        <li v-for="attachment in data.items" :key="attachment.id" class="task-attachment-row">
          <div class="flex items-center gap-2">
            <a :href="attachment.url" target="_blank" rel="noopener" class="min-w-0 flex-1 truncate text-brand-link underline">
              {{ attachment.name }}
            </a>
            <Button
              v-if="props.canWrite && pendingDeleteId !== attachment.id"
              type="button"
              variant="ghost"
              size="icon"
              class="size-[32px] shrink-0 rounded-lg"
              :aria-label="t('attachments.delete')"
              :disabled="!hydrated || deleting || pendingDeleteId !== null"
              @click="requestDelete(attachment.id)"
            >
              <Trash2 class="size-[18px]" />
            </Button>
          </div>
          <div
            v-if="pendingDeleteId === attachment.id"
            role="group"
            :aria-label="t('attachments.deleteConfirm')"
            class="flex flex-wrap items-center justify-between gap-2 border-t pt-2"
          >
            <span class="text-sm text-muted-foreground">{{ t('attachments.deleteConfirm') }}</span>
            <div class="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" :disabled="!hydrated || deleting" @click="cancelDelete">
                {{ t('attachments.cancel') }}
              </Button>
              <Button type="button" variant="destructive" size="sm" :disabled="!hydrated || deleting" @click="confirmDelete(attachment.id)">
                {{ t('attachments.confirm') }}
              </Button>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="props.canWrite" class="mt-3 grid gap-2">
        <Label for="task-attachment-upload">{{ t('attachments.upload') }}</Label>
        <input
          id="task-attachment-upload"
          type="file"
          accept=".txt,.pdf,.png,.jpg,.jpeg,.docx,.xlsx,text/plain,application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="border-input h-9 w-full min-w-0 rounded-lg border bg-transparent px-3 py-1 text-sm shadow-xs file:me-2 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium"
          :disabled="!hydrated || uploading"
          @change="onFileChange"
        >
        <p class="text-xs text-muted-foreground">{{ t('attachments.help') }}</p>
        <p v-if="uploadError" role="alert" class="text-sm text-destructive">{{ uploadError }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.task-list {
  display: grid;
  gap: 2px;
}

.task-attachment-row {
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 0.875rem;
}

.task-attachment-row:last-child {
  border-bottom: 0;
}

.task-empty-inline {
  padding: 10px 0;
  color: var(--muted-foreground);
  font-size: 0.75rem;
}
</style>
