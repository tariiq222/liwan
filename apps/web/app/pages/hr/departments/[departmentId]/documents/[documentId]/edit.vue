<script setup lang="ts">
import { hrDocumentContext } from '@/utils/hrReturnTo'
import DocumentEditor from '@/components/hr/DocumentEditor.vue'
import { useHrDocument, useUpdateDocument, useUploadDocumentAttachment } from '@/composables/useHrDocuments'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const sourcePaths = useRecordListPaths(['/hr/departments', '/hr/documents'])
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const toast = useToast()
const departmentId = computed(() => Number(route.params.departmentId))
const documentId = computed(() => Number(route.params.documentId))
const query = useHrDocument(documentId)
const backTo = computed(() => ({ path: `/hr/departments/${departmentId.value}/documents/${documentId.value}`, query: hrDocumentContext(route.query, departmentId.value, sourcePaths.value), ...(route.hash ? { hash: route.hash } : {}) }))
const name = ref('')
const body = ref('')
const submitted = ref(false)
const saveError = ref('')
const titleError = computed(() => submitted.value && !name.value.trim() ? t('hr.docs.titleRequired') : undefined)
const savedState = ref('')
let initializedId: number | null = null
const { mutateAsync: update, isPending: updating } = useUpdateDocument()
const { mutateAsync: upload, isPending: uploading } = useUploadDocumentAttachment()
const canManage = computed(() => can('hr.documents.manage'))
const fileField = ref<{ reset: () => void } | null>(null)
const dirty = computed(() => initializedId !== null && savedState.value !== JSON.stringify([name.value, body.value]))
function seedDocument(document: typeof query.data.value) {
  if (!document || initializedId === document.id) return
  initializedId = document.id
  name.value = document.name
  body.value = document.body
  savedState.value = JSON.stringify([name.value, body.value])
}
watch(query.data, seedDocument, { immediate: true })
useSsrQuerySeed({ data: query.data }, seedDocument)
async function save() {
  if (!query.data.value || !hydrated.value || updating.value || uploading.value) return
  submitted.value = true
  saveError.value = ''
  const title = name.value.trim()
  if (!title) return
  try {
    const saved = await update({ id: documentId.value, patch: { name: title, body: body.value } })
    name.value = saved.name
    body.value = saved.body
    savedState.value = JSON.stringify([name.value, body.value])
    await navigateTo(backTo.value)
  } catch { saveError.value = t('errors.generic') }
}
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
async function uploadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !query.data.value || updating.value || uploading.value) return
  try { await upload({ id: documentId.value, name: file.name, datas: await readFile(file), mimetype: file.type || undefined }) }
  catch { toast.add({ title: t('errors.generic'), color: 'error' }) }
  finally { input.value = ''; fileField.value?.reset() }
}
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.docs.edit')" :back-to="backTo" />
    <SharedPageState v-if="!canManage" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <UForm v-if="query.data.value" :state="{ name, body }" class="space-y-6" method="post" @submit="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <UAlert v-if="saveError" color="error" variant="subtle" :description="saveError" />
        <SharedFormSection panel :title="t('hr.docs.edit')">
          <div class="grid gap-4">
            <UFormField :label="t('hr.docs.columns.name')" name="hr-doc-title" required :error="titleError">
              <UInput id="hr-doc-title" v-model="name" class="w-full" :disabled="!hydrated || updating" />
            </UFormField>
            <UFormField :label="t('hr.docs.body')" name="hr-doc-body">
              <DocumentEditor v-model="body" :document-id="documentId" :debounce="false" :disabled="updating" />
            </UFormField>
          </div>
        </SharedFormSection>
        <SharedFormSection panel :title="t('hr.docs.attachments')">
          <div class="space-y-3">
            <ul class="grid gap-1 text-sm">
              <li v-for="attachment in query.data.value.attachment_ids" :key="attachment.id">
                <a :href="attachment.url" class="underline" target="_blank" rel="noreferrer">{{ attachment.name }}</a>
              </li>
            </ul>
            <UFormField :label="t('hr.docs.upload')" name="hr-doc-upload">
              <SharedFileField ref="fileField" id="hr-doc-upload" class="w-full" :disabled="!hydrated || uploading || updating" @change="uploadFile" />
            </UFormField>
          </div>
        </SharedFormSection>
        <SharedFormActions class="justify-end">
          <UButton type="button" color="neutral" variant="outline" :disabled="updating" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :loading="updating" :disabled="!hydrated || updating || uploading" :label="t('app.save')" />
        </SharedFormActions>
      </UForm>
    </SharedPageState>
  </SharedPageContainer>
</template>
