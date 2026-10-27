<script setup lang="ts">
import { joinList } from '@/utils/listFormat'
import { ApiError } from '@/composables/useApi'
import { useEmployeeDocumentLink, useEmployeeDocument, useDocumentFiles } from '@/composables/useDocuments'
import { employeeDocumentBack } from '@/lib/documentNavigation'
import DocumentReader from '@/components/documents/DocumentReader.vue'
import DocumentFiles from '@/components/documents/DocumentFiles.vue'
definePageMeta({ path: '/account/documents/:documentId' })
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess()
const documentId = computed(() => Number(route.params.documentId))
const validId = computed(() => /^[1-9]\d*$/.test(String(route.params.documentId)) && Number.isSafeInteger(documentId.value))
const allowed = computed(() => can('documents.items.read') && can('hr.employees.read'))
const employee = useEmployeeDocumentLink(allowed)
const hasEmployee = computed(() => !!employee.data.value && !employee.error.value)
const noEmployee = computed(() => allowed.value && validId.value && employee.data.value === null && !employee.error.value)
const query = useEmployeeDocument(computed(() => validId.value ? documentId.value : null), computed(() => allowed.value && hasEmployee.value))
const document = computed(() => {
  const denied = query.error.value instanceof ApiError && [403, 404].includes(query.error.value.status)
  return allowed.value && hasEmployee.value && !denied ? query.data.value : undefined
})
const fileOffset = ref(0); const fileLimit = 50
watch(documentId, () => { fileOffset.value = 0 })
const fileQuery = useDocumentFiles(computed(() => document.value?.id ?? null), computed(() => ({ limit: fileLimit, offset: fileOffset.value })), computed(() => document.value?.revision ?? 0), async () => {
  fileOffset.value = 0
  await query.refetch()
}, { personal: true })
const filePages = computed(() => Math.max(1, Math.ceil((fileQuery.data.value?.total ?? 0) / fileLimit)))
watch(() => fileQuery.data.value?.total, total => { if (total !== undefined && fileOffset.value >= total && fileOffset.value > 0) fileOffset.value = Math.max(0, Math.ceil(total / fileLimit) - 1) * fileLimit })
const pageError = computed(() => !allowed.value ? new ApiError(403, 'forbidden', t('errors.generic')) : validId.value ? employee.error.value || (hasEmployee.value ? query.error.value : null) : new ApiError(404, 'not_found', t('errors.generic')))
const backTo = computed(() => employeeDocumentBack(route.query))
const hasProperties = computed(() => !!(document.value?.expiry_date || document.value?.tags.length))
</script>
<template>
  <SharedRecordPage :title="document?.name || t('documents.personal.label')" :back-to="backTo" :back-label="t('documents.personal.back')" :loading="employee.isLoading.value || (hasEmployee && query.isLoading.value)" :error="pageError" :keep-content="!!document" @retry="employee.error.value ? employee.refetch() : query.refetch()">
    <template v-if="document" #summary><SharedRecordNumber :value="`#${document.id}`" /></template>
    <SharedEmptyState v-if="noEmployee" :title="t('documents.personal.noEmployee')" :description="t('documents.personal.noEmployeeHelp')" />
    <template v-if="document">
      <UAlert v-if="!document.active" color="neutral" :title="t('documents.archived')" />
      <SharedRecordSection variant="panel" :title="t('documents.body')"><DocumentReader :document="document" /></SharedRecordSection>
      <DocumentFiles :document="document" :readonly="true" :files="fileQuery.data.value?.items" :loading="fileQuery.isFetching.value || fileQuery.isRecovering.value" :error="fileQuery.error.value" :page="Math.floor(fileOffset / fileLimit) + 1" :pages="filePages" @page="fileOffset = ($event - 1) * fileLimit" @retry="fileQuery.refetch()" />
    </template>
    <template v-if="document && hasProperties" #aside><SharedPropertiesPanel :title="t('documents.details')">
      <SharedPropertyRow v-if="document.expiry_date" :label="t('documents.expiry')" :value="document.expiry_date" />
      <SharedPropertyRow v-if="document.tags.length" :label="t('documents.tags')" :value="joinList(document.tags.map(tag => tag.name), t)" />
    </SharedPropertiesPanel></template>
  </SharedRecordPage>
</template>
