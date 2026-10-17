<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useDeleteMyTaskAttachment, useMyTaskAttachments, useUploadMyTaskAttachment } from '@/composables/useMyTasks'
import { ATTACHMENT_ACCEPT, attachmentProblem, fileToBase64 } from '@/utils/attachmentFile'

// The personal task's wiring of `SharedAttachmentList`. `count` is the detail's `attachment_count`;
// the list itself is its own read.
const props = defineProps<{ taskId: number; count: number; canWrite: boolean }>()

const emit = defineEmits<{ 'pending-change': [pending: boolean] }>()
let activeOperations = 0
onBeforeUnmount(() => emit('pending-change', false))
const { t } = useI18n()
const { data, isLoading, error: loadError, refetch } = useMyTaskAttachments(() => props.taskId)
const { mutateAsync: upload } = useUploadMyTaskAttachment()
const { mutateAsync: remove } = useDeleteMyTaskAttachment()

const error = ref('')
const attachments = computed(() => data.value?.items ?? [])
const labels = computed(() => ({
  empty: t('myTasks.attachments.empty'),
  upload: t('myTasks.attachments.upload'),
  help: t('myTasks.attachments.help'),
  delete: t('myTasks.attachments.delete'),
  deleteConfirm: t('myTasks.attachments.deleteConfirm'),
  confirm: t('myTasks.attachments.confirm'),
  keep: t('myTasks.attachments.keep'),
}))

async function uploadFile(file: File) {
  emit('pending-change', ++activeOperations > 0)
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
  } finally { emit('pending-change', --activeOperations > 0) }
}

async function deleteFile(attachmentId: number) {
  emit('pending-change', ++activeOperations > 0)
  error.value = ''
  try {
    await remove({ id: props.taskId, attachmentId })
  } catch (e) {
    // A structured server message wins; a bare transport failure gets the delete-specific text.
    error.value = e instanceof ApiError && e.code !== 'http_error' ? e.message : t('myTasks.attachments.deleteError')
  } finally { emit('pending-change', --activeOperations > 0) }
}
</script>

<template>
  <SharedRecordSection variant="panel" data-testid="my-task-attachments" :title="t('myTasks.attachments.title')">
    <template #actions>
      <span class="text-xs text-muted">{{ t('myTasks.attachments.count', { count: props.count }, props.count) }}</span>
    </template>
    <SharedAttachmentList
      :attachments="attachments"
      :labels="labels"
      :upload-file="uploadFile"
      :delete-file="deleteFile"
      :accept="ATTACHMENT_ACCEPT"
      :can-write="props.canWrite"
      :loading="isLoading"
      :load-error="loadError"
      :error="error"
      upload-id="my-task-attachment-upload"
      @retry="refetch"
    />
  </SharedRecordSection>
</template>
