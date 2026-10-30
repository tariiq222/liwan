<script setup lang="ts">
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import type { DocumentDetail, DocumentFile } from '@liwan/contracts'
const props = defineProps<{ document: DocumentDetail; files?: DocumentFile[]; pending?: boolean; loading?: boolean; error?: unknown; page?: number; pages?: number; readonly?: boolean; duplicate?: File | null }>()
const emit = defineEmits<{ upload: [file: File, options?: { name?: string; asVersion?: boolean }]; cancelDuplicate: []; action: [file: DocumentFile, action: 'archive' | 'restore' | 'lock' | 'unlock']; page: [value: number]; retry: [] }>()
const { t } = useI18n(); const hydrated = useHydrated(); const uploadError = ref(''); const confirmArchive = ref<number | null>(null)
const fileField = ref<{ reset: () => void } | null>(null)
const renaming = ref(false); const newName = ref('')
watch(() => props.duplicate, file => { renaming.value = false; newName.value = file?.name ?? '' })
const newNameValid = computed(() => { const name = newName.value.trim(); return !!name && name !== props.duplicate?.name && !/[\\/\0]/.test(name) && name !== '.' && name !== '..' })
function uploadRenamed() { if (props.duplicate && newNameValid.value && !props.pending) emit('upload', props.duplicate, { name: newName.value.trim() }) }
function uploadAsVersion() { if (props.duplicate && !props.pending) emit('upload', props.duplicate, { asVersion: true }) }
function upload(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]
  uploadError.value = ''
  if (!props.readonly && file && hydrated.value && !props.pending && props.document.allowed_actions.upload_file) {
    if (file.size > 10 * 1024 * 1024) uploadError.value = t('documents.tooLarge')
    else if (!file.size) uploadError.value = t('documents.emptyFile')
    else emit('upload', file)
  }
  input.value = ''; fileField.value?.reset()
}
const fileSize = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`
function actions(file: DocumentFile): RowAction[] {
  const result: RowAction[] = []
  if (props.readonly) return result
  for (const action of ['lock', 'unlock', 'restore'] as const) if (file.allowed_actions[action]) result.push({ label: t(`documents.${action}`), icon: action === 'lock' ? 'i-lucide-lock' : action === 'unlock' ? 'i-lucide-lock-open' : 'i-lucide-archive-restore', onSelect: () => emit('action', file, action) })
  if (file.allowed_actions.archive) result.push({ label: t('documents.archive'), icon: 'i-lucide-archive', destructive: true, onSelect: () => { confirmArchive.value = file.id } })
  return result
}
</script>
<template>
  <SharedRecordSection variant="panel" :title="t('documents.files')">
    <template v-if="!readonly && document.allowed_actions.upload_file" #actions>
      <UFormField name="document-upload" :error="uploadError || undefined">
        <SharedFileField ref="fileField" id="document-upload" :label="t('documents.upload')" :aria-label="t('documents.upload')" aria-describedby="document-upload-help" :show-file-name="false" :disabled="!hydrated || pending" @change="upload" />
      </UFormField>
    </template>
    <UAlert v-if="duplicate" class="mb-4" color="warning" variant="subtle" role="alert" :title="t('documents.duplicateName.title', { name: duplicate.name })" :description="t('documents.duplicateName.help')">
      <template #actions>
        <div class="flex flex-wrap items-center gap-2">
          <template v-if="renaming">
            <UInput v-model="newName" size="sm" :aria-label="t('documents.duplicateName.newName')" :disabled="pending" @keydown.enter.prevent="uploadRenamed" />
            <UButton type="button" size="sm" :label="t('documents.duplicateName.uploadRenamed')" :disabled="!hydrated || pending || !newNameValid" @click="uploadRenamed" />
          </template>
          <UButton v-else type="button" size="sm" color="neutral" variant="outline" :label="t('documents.duplicateName.rename')" :disabled="!hydrated || pending" @click="renaming = true" />
          <UButton type="button" size="sm" color="neutral" variant="outline" :label="t('documents.duplicateName.asVersion')" :disabled="!hydrated || pending" @click="uploadAsVersion" />
          <UButton type="button" size="sm" color="neutral" variant="ghost" :label="t('documents.duplicateName.cancel')" :disabled="pending" @click="emit('cancelDuplicate')" />
        </div>
      </template>
    </UAlert>
    <SharedPageState :loading="loading" :error="props.error" @retry="emit('retry')">
    <SharedEmptyState v-if="!files?.length" compact :title="t('documents.noFiles')" />
    <ul v-else class="grid gap-(--liwan-gap-card)">
      <li v-for="file in files" :key="file.id" class="min-w-0">
        <SharedSubCard>
          <div class="flex flex-wrap items-center gap-2">
            <a :href="file.download_url" download class="min-w-0 break-all font-medium text-primary underline" :aria-label="t('documents.downloadFile', { name: file.name })">{{ file.name }}</a>
            <span class="text-xs text-muted">{{ fileSize(file.file_size) }}</span>
            <SharedStatusBadge v-if="!file.active" tone="neutral" :label="t('documents.archived')" />
            <SharedStatusBadge v-if="file.is_locked" tone="warning" :label="t('documents.locked')" />
            <SharedRowActions v-if="!readonly" class="ms-auto" :actions="actions(file)" :label="t('documents.fileActions', { name: file.name })" :disabled="!hydrated || pending" />
          </div>
          <SharedInlineConfirm v-if="!readonly && confirmArchive === file.id" class="mt-4" :title="t('documents.archiveFileConfirm')" :confirm-label="t('documents.confirmArchive')" :pending="pending" @confirm="emit('action', file, 'archive'); confirmArchive = null" @cancel="confirmArchive = null" />
        </SharedSubCard>
      </li>
    </ul>
    <SharedPagination v-if="(pages ?? 1) > 1" class="mt-4" :page="page ?? 1" :pages="pages ?? 1" :disabled="loading || pending || !hydrated" @update:page="emit('page', $event)" />
    </SharedPageState>
    <p v-if="!readonly && document.allowed_actions.upload_file" id="document-upload-help" class="mt-4 text-xs text-muted">{{ t('documents.uploadHelp') }}</p>
  </SharedRecordSection>
</template>
