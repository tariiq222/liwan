<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useDeleteMeetingAttachment, useMeetingAttachments, useUploadMeetingAttachment } from '@/composables/useMeetings'
import { ATTACHMENT_ACCEPT, attachmentProblem, fileToBase64 } from '@/utils/attachmentFile'

const props = defineProps<{ meetingId: number; canEdit: boolean }>()
const emit = defineEmits<{ count: [count: number] }>()
const { t } = useI18n()
const attachments = useMeetingAttachments(() => props.meetingId)
const { mutateAsync: upload } = useUploadMeetingAttachment()
const { mutateAsync: remove } = useDeleteMeetingAttachment()
const actionError = ref('')
watch(() => attachments.data.value?.items.length ?? 0, count => emit('count', count), { immediate: true })
const labels = computed(() => ({
  empty: t('meetingsUi.emptyAttachments'), upload: t('meetingsUi.uploadAttachment'), help: t('meetingsUi.attachmentHelp'),
  delete: t('attachments.delete'), deleteConfirm: t('attachments.deleteConfirm'), confirm: t('attachments.confirm'), keep: t('attachments.cancel'),
}))
async function uploadFile(file: File) {
  if (!props.canEdit) return
  actionError.value = ''
  const problem = attachmentProblem(file)
  if (problem) { actionError.value = t(`meetingsUx.attachmentErrors.${problem}`); return }
  try {
    await upload({ meetingId: props.meetingId, name: file.name, mimetype: file.type || undefined, data: await fileToBase64(file) })
  } catch (error) {
    actionError.value = error instanceof ApiError ? error.message : t('errors.generic')
  }
}
async function deleteFile(attachmentId: number) {
  if (!props.canEdit) return
  actionError.value = ''
  try { await remove({ meetingId: props.meetingId, attachmentId }) }
  catch (error) { actionError.value = error instanceof ApiError ? error.message : t('errors.generic') }
}
</script>

<template>
  <SharedRecordSection id="meeting-attachments" :title="t('meetingsUi.attachmentsTitle')" panel>
    <SharedAttachmentList :attachments="attachments.data.value?.items ?? []" :labels="labels" :loading="attachments.isLoading.value" :load-error="attachments.error.value" :error="actionError" :can-write="canEdit" :accept="ATTACHMENT_ACCEPT" :upload-file="uploadFile" :delete-file="deleteFile" upload-id="meeting-attachment-upload" @retry="attachments.refetch()" />
  </SharedRecordSection>
</template>
