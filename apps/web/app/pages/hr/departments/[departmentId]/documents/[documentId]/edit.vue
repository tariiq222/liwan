<script setup lang="ts">
import DocumentEditor from '@/components/hr/DocumentEditor.vue'
import { useHrDocument, useUpdateDocument, useUploadDocumentAttachment } from '@/composables/useHrDocuments'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'

const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const toast = useToast()
const departmentId = computed(() => Number(route.params.departmentId))
const documentId = computed(() => Number(route.params.documentId))
const query = useHrDocument(documentId)
// An edit form returns to the record it edits, not past it to the list: being
// thrown back to the list is exactly what the reader did not ask for. The
// target is fixed by this page's own route and carries the list state through,
// so the record's own back control still lands on a filtered list. A referrer's
// returnTo is dropped rather than forwarded: on the destination URL it would
// nest one level deeper on every round trip and redirect that page's controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: `/hr/departments/${departmentId.value}/documents/${documentId.value}`, query: listQuery }
})
const name = ref('')
const body = ref('')
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
  if (!query.data.value || !hydrated.value || !name.value.trim() || updating.value || uploading.value) return
  try {
    const saved = await update({ id: documentId.value, patch: { name: name.value.trim(), body: body.value } })
    name.value = saved.name
    body.value = saved.body
    savedState.value = JSON.stringify([name.value, body.value])
    await navigateTo(backTo.value)
  } catch { toast.add({ title: t('errors.generic'), color: 'error' }) }
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
        <UCard class="nasq-ui-record-surface" :ui="{ header: 'nasq-ui-card-header' }">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.docs.edit') }}</h2></template>
          <div class="grid gap-4">
            <UFormField :label="t('hr.docs.columns.name')" name="hr-doc-title">
              <UInput id="hr-doc-title" v-model="name" class="w-full" :disabled="!hydrated || updating" />
            </UFormField>
            <UFormField :label="t('hr.docs.body')" name="hr-doc-body">
              <DocumentEditor v-model="body" :document-id="documentId" :debounce="false" :disabled="updating" />
            </UFormField>
          </div>
        </UCard>
        <UCard class="nasq-ui-record-surface" :ui="{ header: 'nasq-ui-card-header' }">
          <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.docs.attachments') }}</h2></template>
          <div class="space-y-3">
            <ul class="grid gap-1 text-sm">
              <li v-for="attachment in query.data.value.attachment_ids" :key="attachment.id">
                <a :href="`/web/content/${attachment.id}`" class="underline" target="_blank" rel="noreferrer">{{ attachment.name }}</a>
              </li>
            </ul>
            <UFormField :label="t('hr.docs.upload')" name="hr-doc-upload">
              <SharedFileField ref="fileField" id="hr-doc-upload" class="w-full" :disabled="!hydrated || uploading || updating" @change="uploadFile" />
            </UFormField>
          </div>
        </UCard>
        <footer class="nasq-form-footer justify-end">
          <UButton type="button" color="neutral" variant="outline" :disabled="updating" :to="backTo" :label="t('app.cancel')" />
          <UButton type="submit" color="primary" :disabled="!hydrated || updating || uploading || !name.trim()" :label="t('app.save')" />
        </footer>
      </UForm>
    </SharedPageState>
  </SharedPageContainer>
</template>
