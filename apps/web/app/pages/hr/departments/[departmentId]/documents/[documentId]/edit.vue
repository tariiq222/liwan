<script setup lang="ts">
import { toast } from 'vue-sonner'
import DocumentEditor from '@/components/hr/DocumentEditor.vue'
import { useHrDocument, useUpdateDocument, useUploadDocumentAttachment } from '@/composables/useHrDocuments'
import { safeReturnTo } from '@/utils/safeReturnTo'

const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const departmentId = computed(() => Number(route.params.departmentId))
const documentId = computed(() => Number(route.params.documentId))
const query = useHrDocument(documentId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/departments/${departmentId.value}/documents/${documentId.value}`, ['/hr']))
const name = ref('')
const body = ref('')
const savedState = ref('')
let initializedId: number | null = null
const { mutateAsync: update, isPending: updating } = useUpdateDocument()
const { mutateAsync: upload, isPending: uploading } = useUploadDocumentAttachment()
const dirty = computed(() => initializedId !== null && savedState.value !== JSON.stringify([name.value, body.value]))
watch(query.data, (document) => {
  if (!document || initializedId === document.id) return
  initializedId = document.id
  name.value = document.name
  body.value = document.body
  savedState.value = JSON.stringify([name.value, body.value])
}, { immediate: true })
async function save() {
  if (!query.data.value || !hydrated.value || !name.value.trim() || updating.value || uploading.value) return
  try {
    const saved = await update({ id: documentId.value, patch: { name: name.value.trim(), body: body.value } })
    name.value = saved.name
    body.value = saved.body
    savedState.value = JSON.stringify([name.value, body.value])
    await navigateTo(returnTo.value)
  } catch { toast.error(t('errors.generic')) }
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
  catch { toast.error(t('errors.generic')) }
  finally { input.value = '' }
}
</script>
<template>
  <div class="space-y-6">
    <SharedPageHeader :title="t('hr.docs.title')" :back-to="returnTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <form v-if="query.data.value" class="grid max-w-2xl gap-4" @submit.prevent="save">
        <SharedUnsavedChanges :dirty="dirty" />
        <div class="grid gap-2"><Label for="hr-doc-title">{{ t('hr.docs.columns.name') }}</Label><Input id="hr-doc-title" v-model="name" :disabled="!hydrated || updating" /></div>
        <div class="grid gap-2"><Label>{{ t('hr.docs.body') }}</Label><DocumentEditor v-model="body" :document-id="documentId" :debounce="false" :disabled="updating" /></div>
        <div class="grid gap-2">
          <h2 class="text-sm font-medium">{{ t('hr.docs.attachments') }}</h2>
          <ul class="grid gap-1 text-sm"><li v-for="attachment in query.data.value.attachment_ids" :key="attachment.id"><a :href="`/web/content/${attachment.id}`" class="underline" target="_blank" rel="noreferrer">{{ attachment.name }}</a></li></ul>
          <Label for="hr-doc-upload">{{ t('hr.docs.upload') }}</Label><input id="hr-doc-upload" type="file" :disabled="!hydrated || uploading || updating" @change="uploadFile">
        </div>
        <div class="flex gap-2"><NuxtLink :to="returnTo"><Button type="button" variant="outline" :disabled="updating">{{ t('app.cancel') }}</Button></NuxtLink><Button type="submit" :disabled="!hydrated || updating || uploading || !name.trim()">{{ t('app.save') }}</Button></div>
      </form>
    </SharedPageState>
  </div>
</template>
