<script setup lang="ts">
import { hrDocumentBack, hrDocumentContext } from '@/utils/hrReturnTo'
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
const route = useRoute()
const sourcePaths = useRecordListPaths(['/hr/departments', '/hr/documents']); const { t } = useI18n(); const id = computed(() => Number(route.params.departmentId)); const { can } = useAccess()
const backTo = computed(() => hrDocumentBack(route.query, id.value, route.hash, sourcePaths.value))
function saved(documentId: number) { void navigateTo({ path: `/hr/departments/${id.value}/documents/${documentId}`, query: hrDocumentContext(route.query, id.value, sourcePaths.value), ...(route.hash ? { hash: route.hash } : {}) }) }
</script>
<template>
  <SharedCreatePanel :title="t('hr.docs.new')" :back-to="backTo">
    <SharedPageState v-if="!can('hr.documents.manage')" :empty="true" :empty-text="t('errors.forbidden')" />
    <DocumentCreateForm v-else :department-id="id" :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
