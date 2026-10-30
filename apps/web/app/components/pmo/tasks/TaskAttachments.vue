<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useDeleteTaskAttachment, useTaskAttachments, useUploadTaskAttachment } from '@/composables/useTaskAttachments'
import { ATTACHMENT_ACCEPT, MAX_ATTACHMENT_BYTES, fileToBase64 } from '@/utils/attachmentFile'

// The project task's wiring of `SharedAttachmentList`.
const props = defineProps<{ taskId: number; canWrite: boolean }>()

const { t } = useI18n()
const toast = useToast()
const error = ref('')
const { data, isLoading, error: loadError, refetch } = useTaskAttachments(() => props.taskId)
const { mutateAsync: upload } = useUploadTaskAttachment()
const { mutateAsync: remove } = useDeleteTaskAttachment()
const labels = computed(() => ({
  empty: t('attachments.empty'),
  upload: t('attachments.upload'),
  help: t('attachments.help'),
  delete: t('attachments.delete'),
  deleteConfirm: t('attachments.deleteConfirm'),
  confirm: t('attachments.confirm'),
  keep: t('attachments.cancel'),
}))

function fail(e: unknown) {
  error.value = e instanceof ApiError || e instanceof Error ? e.message : t('errors.generic')
  toast.add({ title: error.value, color: 'error' })
}

async function uploadFile(file: File) {
  error.value = ''
  try {
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(t('attachments.errors.tooLarge'))
    await upload({ taskId: props.taskId, name: file.name, mimetype: file.type || undefined, data: await fileToBase64(file) })
    toast.add({ title: t('attachments.uploaded'), color: 'success' })
  } catch (e) {
    fail(e)
  }
}

async function deleteFile(attachmentId: number) {
  error.value = ''
  try {
    await remove({ taskId: props.taskId, attachmentId })
    toast.add({ title: t('attachments.deleted'), color: 'success' })
  } catch (e) {
    fail(e)
  }
}
</script>

<template>
  <section data-testid="task-attachments" class="space-y-3">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-lg font-semibold text-highlighted">{{ t('attachments.title') }}</h2>
      <span v-if="data" class="text-xs text-muted">{{ data.items.length }}</span>
    </header>
    <SharedAttachmentList
      :attachments="data?.items ?? []"
      :labels="labels"
      :upload-file="uploadFile"
      :delete-file="deleteFile"
      :accept="ATTACHMENT_ACCEPT"
      :can-write="props.canWrite"
      :loading="isLoading"
      :load-error="loadError"
      :error="error"
      upload-id="task-attachment-upload"
      @retry="refetch"
    />
  </section>
</template>
