<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
import type { DocumentFile } from '@webvue/contracts'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import { useDocument, useDocumentFiles, useDocumentTransition, useUploadDocumentFile, useDocumentFileAction } from '@/composables/useDocuments'
import { documentRecordBack, documentChildTo } from '@/lib/documentNavigation'
import DocumentReader from '@/components/documents/DocumentReader.vue'
import DocumentFiles from '@/components/documents/DocumentFiles.vue'
const route = useRoute(); const { t } = useI18n(); const hydrated = useHydrated(); const toast = useToast()
const documentId = computed(() => Number(route.params.documentId)); const validId = computed(() => /^[1-9]\d*$/.test(String(route.params.documentId)) && Number.isSafeInteger(documentId.value))
const isRecord = computed(() => route.path.replace(/\/$/, '') === `/documents/${route.params.documentId}`)
const query = useDocument(computed(() => isRecord.value && validId.value ? documentId.value : null)); const document = computed(() => query.data.value)
const fileOffset = ref(0); const fileLimit = 50
watch(documentId, () => { fileOffset.value = 0 })
const fileQuery = useDocumentFiles(computed(() => document.value?.id ?? null), computed(() => ({ limit: fileLimit, offset: fileOffset.value })), computed(() => document.value?.revision ?? 0), async () => {
  fileOffset.value = 0
  await query.refetch()
})
const filePages = computed(() => Math.max(1, Math.ceil((fileQuery.data.value?.total ?? 0) / fileLimit)))
watch(() => fileQuery.data.value?.total, total => { if (total !== undefined && fileOffset.value >= total && fileOffset.value > 0) fileOffset.value = Math.max(0, Math.ceil(total / fileLimit) - 1) * fileLimit })
const pageError = computed(() => validId.value ? query.error.value : new ApiError(404, 'not_found', t('errors.generic')))
const backTo = computed(() => documentRecordBack(route.query, route.hash))
const backLabel = computed(() => {
  const target = backTo.value
  const path = typeof target === 'string' ? target : 'path' in target ? target.path : ''
  return path?.startsWith('/documents') ? t('documents.backToDocuments') : t('app.back')
})
const headerTags = computed(() => document.value
  ? [{ label: t(`documents.visibilityOptions.${document.value.visibility}`), icon: document.value.visibility === 'restricted' ? 'i-lucide-lock-keyhole' : 'i-lucide-building-2', kind: 'category' } satisfies PageHeaderTag]
  : [])
const hasProperties = computed(() => !!(document.value?.expiry_date || document.value?.context || document.value?.tags.length))
const childTo = (suffix: string) => documentChildTo(`/documents/${documentId.value}/${suffix}`, route.query, route.hash)
const transition = useDocumentTransition(); const uploadMutation = useUploadDocumentFile(); const fileMutation = useDocumentFileAction()
const readingFile = ref(false); const pending = computed(() => readingFile.value || transition.isPending.value || uploadMutation.isPending.value || fileMutation.isPending.value)
const error = ref(''); const confirmArchive = ref(false)
async function perform(operation: () => Promise<unknown>) {
  error.value = ''
  try { await operation(); toast.add({ title: t('documents.saved'), color: 'success' }) }
  catch (cause) { error.value = cause instanceof ApiError && cause.status === 409 ? t('documents.fileConflict') : cause instanceof ApiError ? cause.message : t('errors.generic'); if (cause instanceof ApiError && cause.status === 409) await Promise.all([query.refetch(), fileQuery.refetch()]) }
}
async function changeState(action: 'archive' | 'restore') {
  if (!document.value || !hydrated.value || pending.value) return
  const revision = document.value.revision
  await perform(() => transition.mutateAsync({ id: documentId.value, action, expected_revision: revision })); confirmArchive.value = false
}
async function fileAction(file: DocumentFile, action: 'archive' | 'restore' | 'lock' | 'unlock') {
  if (!document.value || !hydrated.value || pending.value || !file.allowed_actions[action]) return
  const revision = document.value.revision
  await perform(() => fileMutation.mutateAsync({ id: documentId.value, fileId: file.id, action, expected_revision: revision }))
}
async function upload(file: File) {
  if (!document.value?.allowed_actions.upload_file || !hydrated.value || pending.value) return
  const revision = document.value.revision; readingFile.value = true
  await perform(async () => {
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file) })
    await uploadMutation.mutateAsync({ id: documentId.value, body: { name: file.name, data, expected_revision: revision, ...(file.type ? { mimetype: file.type } : {}) } })
  })
  readingFile.value = false
}
const secondaryActions = computed<RowAction[]>(() => {
  const value = document.value; if (!value) return []
  const actions: RowAction[] = []
  if (value.allowed_actions.restore) actions.push({ label: t('documents.restore'), icon: 'i-lucide-archive-restore', onSelect: () => { void changeState('restore') } })
  if (value.allowed_actions.archive) actions.push({ label: t('documents.archive'), icon: 'i-lucide-archive', destructive: true, onSelect: () => { confirmArchive.value = true } })
  return actions
})
</script>
<template>
  <SharedRecordPage v-if="isRecord" :title="document?.name || t('documents.title')" :tags="headerTags" :back-to="backTo" :back-label="backLabel" :loading="query.isLoading.value" :error="pageError" :keep-content="!!document" @retry="query.refetch">
    <template v-if="document" #actions>
      <UButton v-if="document.allowed_actions.manage_access" :to="childTo('access')" color="neutral" variant="outline" icon="i-lucide-users" :disabled="!hydrated || pending" :label="t('documents.access')" />
      <UButton v-if="document.allowed_actions.update" icon="i-lucide-pencil" :to="childTo('edit')" :disabled="!hydrated || pending" :label="t('documents.edit')" />
      <SharedRowActions :actions="secondaryActions" :label="t('documents.actions')" :disabled="!hydrated || pending" />
    </template>
    <template v-if="document" #summary>
      <div class="flex flex-wrap items-center gap-2">
        <SharedRecordNumber :value="`#${document.id}`" />
      </div>
    </template>
    <template v-if="document">
      <SharedUnsavedChanges :dirty="pending" />
      <UAlert v-if="error" color="error" :title="error" />
      <SharedInlineConfirm v-if="confirmArchive" :title="t('documents.archiveConfirm')" :confirm-label="t('documents.confirmArchive')" :pending="pending" @confirm="changeState('archive')" @cancel="confirmArchive = false" />
      <UAlert v-if="!document.active" color="neutral" :title="t('documents.archived')" />
      <SharedRecordSection variant="panel" :title="t('documents.body')"><DocumentReader :document="document" /></SharedRecordSection>
      <DocumentFiles :document="document" :files="fileQuery.data.value?.items" :loading="fileQuery.isFetching.value || fileQuery.isRecovering.value" :error="fileQuery.error.value" :page="Math.floor(fileOffset / fileLimit) + 1" :pages="filePages" :pending="pending" @page="fileOffset = ($event - 1) * fileLimit" @retry="fileQuery.refetch()" @upload="upload" @action="fileAction" />
    </template>
    <template v-if="document && hasProperties" #aside><SharedPropertiesPanel :title="t('documents.details')">
      <SharedPropertyRow v-if="document.expiry_date" :label="t('documents.expiry')" :value="document.expiry_date || '—'" />
      <SharedPropertyRow v-if="document.context" :label="t('documents.context')"><NuxtLink v-if="document.context?.href && document.context?.label" :to="document.context.href" class="text-primary underline">{{ document.context.label }}</NuxtLink><span v-else>{{ document.context?.label || '—' }}</span></SharedPropertyRow>
      <SharedPropertyRow v-if="document.tags.length" :label="t('documents.tags')" :value="joinList(document.tags.map(tag => tag.name), t) || '—'" />
    </SharedPropertiesPanel></template>
  </SharedRecordPage>
  <NuxtPage />
</template>
