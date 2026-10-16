<script setup lang="ts">
import { hrDocumentBack, hrDocumentContext } from '@/utils/hrReturnTo'
import DocumentReader from '@/components/hr/DocumentReader.vue'
import { useHrDocument } from '@/composables/useHrDocuments'
const route = useRoute()
const sourcePaths = useRecordListPaths(['/hr/departments', '/hr/documents']); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.departmentId))
const documentId = computed(() => Number(route.params.documentId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0 && Number.isSafeInteger(documentId.value) && documentId.value > 0)
const query = useHrDocument(computed(() => validId.value ? documentId.value : null))
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => hrDocumentBack(route.query, id.value, route.hash, sourcePaths.value))
const editTo = computed(() => ({ path: `/hr/departments/${id.value}/documents/${documentId.value}/edit`, query: hrDocumentContext(route.query, id.value, sourcePaths.value), ...(route.hash ? { hash: route.hash } : {}) }))
const isEdit = computed(() => route.path.endsWith('/edit'))
</script>
<template>
  <SharedRecordPage
    v-if="!isEdit"
    :title="query.data.value?.name || t('hr.docs.title')"
    :description="query.data.value?.department.name"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="query.data.value && can('hr.documents.manage')" #actions>
      <UButton color="primary" :disabled="!hydrated" :to="editTo" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
    </template>
    <SharedRecordSection v-if="query.data.value" :title="t('hr.docs.body')">
      <DocumentReader :document="query.data.value" hide-title />
    </SharedRecordSection>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
