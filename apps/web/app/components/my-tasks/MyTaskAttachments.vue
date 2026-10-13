<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useDeleteMyTaskAttachment, useMyTaskAttachments, useUploadMyTaskAttachment } from '@/composables/useMyTasks'
import { ATTACHMENT_ACCEPT, attachmentProblem, fileToBase64 } from '@/utils/myTaskDetail'

// `count` is the detail's `attachment_count`; the list itself is its own read.
const props = defineProps<{ taskId: number; count: number; canWrite: boolean }>()

const { t } = useI18n()
const hydrated = useHydrated()
const { data, isLoading, error: loadError, refetch } = useMyTaskAttachments(() => props.taskId)
const { mutateAsync: upload, isPending: uploading } = useUploadMyTaskAttachment()
const { mutateAsync: remove, isPending: deleting } = useDeleteMyTaskAttachment()

// Refs read back synchronously, so these double as in-flight guards set before the first await
// (`isPending` of a mutation reaches a guard a macrotask late).
const uploadBusy = ref(false)
const deleteBusy = ref(false)
const fileField = ref<{ reset: () => void } | null>(null)
const error = ref('')
const pendingDeleteId = ref<number | null>(null)
const attachments = computed(() => data.value?.items ?? [])

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || uploadBusy.value) return
  uploadBusy.value = true
  error.value = ''
  try {
    const problem = attachmentProblem(file)
    if (problem) {
      error.value = t(`myTasks.attachments.errors.${problem}`)
      return
    }
    await upload({ id: props.taskId, name: file.name, mimetype: file.type || undefined, data: await fileToBase64(file) })
  } catch (e) {
    error.value = e instanceof ApiError ? e.message : t('myTasks.errors.attachment')
  } finally {
    // Clearing the input lets the same file be chosen again after an error.
    fileField.value?.reset()
    uploadBusy.value = false
  }
}

async function confirmDelete(attachmentId: number) {
  if (pendingDeleteId.value !== attachmentId || deleting.value || deleteBusy.value) return
  deleteBusy.value = true
  error.value = ''
  try {
    await remove({ id: props.taskId, attachmentId })
  } catch (e) {
    // A structured server message wins; a bare transport failure gets the delete-specific text.
    error.value = e instanceof ApiError && e.code !== 'http_error' ? e.message : t('myTasks.attachments.deleteError')
  } finally {
    pendingDeleteId.value = null
    deleteBusy.value = false
  }
}
</script>

<template>
  <section data-testid="my-task-attachments" class="space-y-3" :aria-label="t('myTasks.attachments.title')">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-highlighted">{{ t('myTasks.attachments.title') }}</h2>
      <span class="text-xs text-muted">{{ t('myTasks.attachments.count', { count: props.count }) }}</span>
    </header>

    <SharedPageState :loading="isLoading" :error="loadError" :empty="!attachments.length" :empty-text="t('myTasks.attachments.empty')" @retry="refetch">
      <ul class="divide-y divide-default">
        <li v-for="attachment in attachments" :key="attachment.id" class="grid min-w-0 gap-2 py-2 text-sm">
          <div class="flex items-center gap-2">
            <a :href="attachment.url" target="_blank" rel="noopener" class="min-w-0 flex-1 truncate text-brand-link underline">{{ attachment.name }}</a>
            <UButton
              v-if="props.canWrite && pendingDeleteId !== attachment.id"
              type="button"
              variant="ghost"
              size="sm"
              color="error"
              square
              icon="i-lucide-trash-2"
              :aria-label="t('myTasks.attachments.delete')"
              :disabled="!hydrated || deleting || deleteBusy || pendingDeleteId !== null"
              @click="pendingDeleteId = attachment.id"
            />
          </div>
          <SharedInlineConfirm
            v-if="pendingDeleteId === attachment.id"
            :title="t('myTasks.attachments.deleteConfirm')"
            :confirm-label="t('myTasks.attachments.confirm')"
            :cancel-label="t('myTasks.attachments.keep')"
            :pending="deleting || deleteBusy"
            @confirm="confirmDelete(attachment.id)"
            @cancel="pendingDeleteId = null"
          />
        </li>
      </ul>
    </SharedPageState>

    <div v-if="props.canWrite" class="grid gap-2">
      <label for="my-task-attachment-upload" class="text-sm font-medium text-default">{{ t('myTasks.attachments.upload') }}</label>
      <SharedFileField
        id="my-task-attachment-upload"
        ref="fileField"
        :accept="ATTACHMENT_ACCEPT"
        class="w-full min-w-0"
        :disabled="!hydrated || uploading || uploadBusy"
        @change="onFileChange"
      />
      <p class="text-xs text-muted">{{ t('myTasks.attachments.help') }}</p>
    </div>
    <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
  </section>
</template>
