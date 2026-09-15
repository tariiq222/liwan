<script setup lang="ts">
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
const route = useRoute(); const { t } = useI18n(); const id = computed(() => Number(route.params.departmentId)); const { can } = useAccess()
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/documents', query: listQuery }
})
function saved(documentId: number) { void navigateTo(`/hr/departments/${id.value}/documents/${documentId}`) }
</script>
<template>
  <SharedCreatePanel :title="t('hr.docs.new')" :back-to="backTo">
    <SharedPageState v-if="!can('hr.documents.manage')" :empty="true" :empty-text="t('errors.forbidden')" />
    <DocumentCreateForm v-else :department-id="id" :back-to="backTo" @saved="saved" />
  </SharedCreatePanel>
</template>
