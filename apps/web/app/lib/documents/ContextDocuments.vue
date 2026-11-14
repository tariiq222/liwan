<script setup lang="ts">
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import { DocumentAccessSchema, DocumentDetailSchema, DocumentFileListSchema, DocumentListSchema, type DocumentAccessUpdate, type DocumentCreate, type DocumentFile } from '@liwan/contracts'
import DocumentAccessForm from '@/components/documents/DocumentAccessForm.vue'
import DocumentCreateForm from '@/components/documents/DocumentCreateForm.vue'
import DocumentEditor from '@/components/documents/DocumentEditor.vue'
import DocumentFiles from '@/components/documents/DocumentFiles.vue'
import DocumentReader from '@/components/documents/DocumentReader.vue'
import { readDocumentFile } from '@/composables/useDocuments'

const route = useRoute()
const { $api } = useApi()
const { me } = useMe()
const { t } = useI18n()
const hydrated = useHydrated()
const kind = computed(() => String(route.params.kind))
const subjectId = computed(() => Number(route.params.subjectId))
const validSubject = computed(() => ['employee', 'department'].includes(kind.value) && Number.isSafeInteger(subjectId.value) && subjectId.value > 0)
const endpoint = computed(() => `/api/v1/hr/documents/${kind.value}/${subjectId.value}`)
const backTo = computed(() => `/hr/${kind.value === 'department' ? 'departments' : 'employees'}/${subjectId.value}`)
const authorizations = computed(() => me.value?.capabilities ?? [])
const canCreate = computed(() => !!me.value?.platform?.writable_features.includes('hr.enabled') && authorizations.value.includes('documents.items.manage')
  && authorizations.value.includes(kind.value === 'department' ? 'hr.departments.manage' : 'hr.employees.manage'))
const offset = ref(0)
const archived = ref(false)
watch(archived, () => { offset.value = 0 })
const canArchive = computed(() => authorizations.value.includes('documents.items.archive'))
const fileOffset = ref(0)
const selectedId = computed(() => {
  const value = Number(route.query.document)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const selectedPath = computed(() => `${endpoint.value}/${selectedId.value}`)
const list = useQuery({
  queryKey: computed(() => ['hr', me.value?.company.id, endpoint.value, offset.value, archived.value]),
  enabled: computed(() => validSubject.value && !!me.value),
  queryFn: () => $api(endpoint.value, { query: { limit: 25, offset: offset.value, archived: archived.value ? '1' : undefined }, schema: DocumentListSchema }),
})
const detail = useQuery({
  queryKey: computed(() => ['hr', me.value?.company.id, selectedPath.value]),
  enabled: computed(() => validSubject.value && !!me.value && selectedId.value !== null),
  queryFn: () => $api(selectedPath.value, { schema: DocumentDetailSchema }),
})
const files = useQuery({
  queryKey: computed(() => ['hr', me.value?.company.id, selectedPath.value, 'files', fileOffset.value, detail.data.value?.revision]),
  enabled: computed(() => !!detail.data.value),
  queryFn: () => $api(`${selectedPath.value}/files`, { query: { limit: 25, offset: fileOffset.value, revision: detail.data.value?.revision }, schema: DocumentFileListSchema }),
})
const cache = useQueryClient()
const managingAccess = computed(() => route.query.access === '1' && !!detail.data.value?.allowed_actions.manage_access)
const accessEndpoint = computed(() => `${selectedPath.value}/access`)
const accessKey = computed(() => ['hr', me.value?.company.id, accessEndpoint.value] as const)
const access = useQuery({
  queryKey: accessKey,
  enabled: managingAccess,
  queryFn: ({ queryKey, signal }) => {
    if (queryKey[1] !== me.value?.company.id) throw new ApiError(409, 'company_changed', t('errors.generic'))
    return $api(queryKey[2], { schema: DocumentAccessSchema, signal })
  },
})
const accessConflict = ref(false)
const accessFormKey = ref(0)
const creating = ref(false)
const editing = ref(false)
const name = ref('')
const body = ref('')
const pending = ref(false)
const error = ref('')
const duplicate = ref<File | null>(null)
watch([endpoint, selectedId, () => me.value?.company.id], () => { editing.value = false; accessConflict.value = false; accessFormKey.value++; fileOffset.value = 0; duplicate.value = null; error.value = '' })
function recordHref(id: number) { return { path: route.path, query: { ...route.query, document: id } } }
function edit() {
  if (!detail.data.value) return
  name.value = detail.data.value.name
  body.value = detail.data.value.body
  editing.value = true
}
async function create(values: DocumentCreate) {
  return $api(endpoint.value, { method: 'POST', body: { name: values.name, body: values.body, expiry_date: values.expiry_date }, schema: DocumentDetailSchema })
}
async function openCreated(id: number) {
  creating.value = false
  await list.refetch()
  await navigateTo(recordHref(id))
}
async function perform(work: () => Promise<unknown>) {
  if (!hydrated.value || pending.value) return
  pending.value = true
  error.value = ''
  try {
    await work()
    await detail.refetch()
    await Promise.all([list.refetch(), files.refetch()])
  } catch (cause) {
    if (cause instanceof ApiError && cause.status === 409 && cause.code !== 'duplicate_name') await detail.refetch()
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  } finally { pending.value = false }
}
async function save() {
  const document = detail.data.value
  if (!document?.allowed_actions.update || !name.value.trim()) return
  await perform(async () => {
    await $api(selectedPath.value, { method: 'PATCH', body: {
      name: name.value.trim(), body: body.value, expected_revision: document.revision,
    }, schema: DocumentDetailSchema })
    editing.value = false
  })
}
async function upload(file: File, options: { name?: string; asVersion?: boolean } = {}) {
  const document = detail.data.value
  if (!document?.allowed_actions.upload_file) return
  const target = selectedPath.value
  const company = me.value?.company.id
  duplicate.value = null
  await perform(async () => {
    const data = await readDocumentFile(file)
    if (target !== selectedPath.value || company !== me.value?.company.id) return
    try {
      await $api(`${target}/files`, { method: 'POST', body: {
        name: options.name ?? file.name, data, mimetype: file.type || undefined,
        as_version: options.asVersion, expected_revision: document.revision,
      }, schema: DocumentDetailSchema })
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'duplicate_name') duplicate.value = file
      else throw cause
    }
  })
}
async function fileAction(file: DocumentFile, action: 'archive' | 'restore' | 'lock' | 'unlock') {
  const document = detail.data.value
  if (!document || !file.allowed_actions[action]) return
  await perform(() => $api(`${selectedPath.value}/files/${file.id}/${action}`, {
    method: 'POST', body: { expected_revision: document.revision }, schema: DocumentDetailSchema,
  }))
}
const confirmArchive = ref(false)
async function documentAction(action: 'archive' | 'restore') {
  const document = detail.data.value
  if (!document?.allowed_actions[action]) return
  await perform(() => $api(`${selectedPath.value}/${action}`, {
    method: 'POST', body: { expected_revision: document.revision }, schema: DocumentDetailSchema,
  }))
  confirmArchive.value = false
}
const closeAccess = computed(() => {
  const { access: _access, ...query } = route.query
  return { path: route.path, query }
})
async function reloadAccess() {
  const result = await access.refetch()
  if (!result.data || result.error) return
  error.value = ''
  accessConflict.value = false
  accessFormKey.value++
}
async function saveAccess(payload: DocumentAccessUpdate) {
  if (accessConflict.value) return
  const key = accessKey.value
  await perform(async () => {
    try {
      const saved = await $api(key[2], { method: 'PUT', body: payload, schema: DocumentAccessSchema })
      if (key[2] !== accessEndpoint.value || key[1] !== me.value?.company.id) return
      cache.setQueryData(key, saved)
      accessFormKey.value++
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) accessConflict.value = true
      throw cause
    }
  })
}
async function shareWithEmployee() {
  const document = detail.data.value
  if (kind.value !== 'employee' || !document?.allowed_actions.manage_access) return
  await perform(() => $api(`${selectedPath.value}/employee-access`, {
    method: 'POST', body: { expected_revision: document.revision }, schema: DocumentAccessSchema,
  }))
}
</script>

<template>
    <SharedPageHeader :title="t('documents.title')" :back-to="backTo">
      <template #actions>
        <UButton v-if="canCreate && !selectedId && !creating" :label="t('documents.new')" :disabled="!hydrated" @click="creating = true" />
        <UButton v-if="canArchive && !selectedId && !creating" variant="outline" :label="t(archived ? 'documents.title' : 'documents.archived')" @click="archived = !archived" />
        <UButton v-if="detail.data.value?.allowed_actions.update && !editing && !managingAccess" :label="t('documents.edit')" :disabled="!hydrated" @click="edit" />
        <UButton v-if="detail.data.value?.allowed_actions.manage_access && !editing && !managingAccess"
          color="neutral" variant="outline" :label="t('documents.access')"
          :to="{ path: route.path, query: { ...route.query, access: '1' } }" :disabled="pending" />
        <UButton v-if="kind === 'employee' && detail.data.value?.allowed_actions.manage_access && !managingAccess" color="neutral" variant="outline" :label="t('documents.shareWithEmployee')" :disabled="pending" @click="shareWithEmployee" />
        <UButton v-if="detail.data.value?.allowed_actions.archive && !managingAccess" color="neutral" variant="outline" :label="t('documents.archive')" :disabled="pending" @click="confirmArchive = true" />
        <UButton v-if="detail.data.value?.allowed_actions.restore && !managingAccess" color="neutral" variant="outline" :label="t('documents.restore')" :disabled="pending" @click="documentAction('restore')" />
      </template>
    </SharedPageHeader>
    <SharedNotFoundState v-if="!validSubject" />
    <DocumentCreateForm v-else-if="creating" :back-to="backTo" :contextual-save="create" @saved="openCreated" />
    <SharedPageState v-else-if="managingAccess" :loading="access.isPending.value" :error="access.error.value" @retry="access.refetch()">
      <DocumentAccessForm v-if="access.data.value" :key="accessFormKey" :access="access.data.value"
        :people-endpoint="`${accessEndpoint}/people`" :restrict-visibility="kind === 'employee'"
        :back-to="closeAccess" :pending="pending" :conflict="accessConflict" :error="error"
        @save="saveAccess" @reload="reloadAccess" />
    </SharedPageState>
    <SharedPageState v-else-if="selectedId" :loading="detail.isPending.value" :error="detail.error.value" @retry="detail.refetch()">
      <SharedInlineConfirm v-if="confirmArchive" :title="t('documents.archive')" :confirm-label="t('documents.archive')" :pending="pending" @confirm="documentAction('archive')" @cancel="confirmArchive = false" />
      <UAlert v-if="error"  color="error" :title="error" />
      <template v-if="detail.data.value">
        <UButton color="neutral" variant="outline" :to="{ path: route.path }" :label="t('documents.backToDocuments')" />
        <UForm v-if="editing" :state="{ name, body }" class="liwan-form" @submit="save">
          <SharedUnsavedChanges :dirty="name !== detail.data.value.name || body !== detail.data.value.body" />
          <UFormField :label="t('documents.columns.name')" name="name" required><UInput v-model="name" :disabled="pending" required /></UFormField>
          <UFormField :label="t('documents.body')" name="body"><DocumentEditor v-model="body" :document-id="selectedId" :debounce="false" :disabled="pending" /></UFormField>
          <SharedFormActions><UButton type="submit" :label="t('app.saveChanges')" :loading="pending" :disabled="!hydrated || !name.trim()" /></SharedFormActions>
        </UForm>
        <SharedRecordSection v-else :title="detail.data.value.name"><DocumentReader :document="detail.data.value" /></SharedRecordSection>
        <DocumentFiles :document="detail.data.value" :files="files.data.value?.items" :pending="pending" :loading="files.isFetching.value" :error="files.error.value"
          :page="Math.floor(fileOffset / 25) + 1" :pages="Math.ceil((files.data.value?.total ?? 0) / 25)" :duplicate="duplicate"
          @page="fileOffset = ($event - 1) * 25" @retry="files.refetch()" @upload="upload" @action="fileAction" @cancel-duplicate="duplicate = null" />
      </template>
    </SharedPageState>
    <SharedPageState v-else :loading="list.isPending.value" :error="list.error.value" @retry="list.refetch()">
      <SharedEmptyState v-if="!list.data.value?.items.length" :title="t('documents.personal.empty')" />
      <ul v-else class="grid gap-3">
        <li v-for="document in list.data.value.items" :key="document.id">
          <UButton variant="ghost" :to="recordHref(document.id)" :label="document.name" />
        </li>
      </ul>
      <SharedPagination v-if="(list.data.value?.total ?? 0) > 25" :page="Math.floor(offset / 25) + 1" :pages="Math.ceil((list.data.value?.total ?? 0) / 25)" @update:page="offset = ($event - 1) * 25" />
    </SharedPageState>
</template>
