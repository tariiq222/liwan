<script setup lang="ts">
import DocumentReader from '@/components/hr/DocumentReader.vue'
import { useHrDocument } from '@/composables/useHrDocuments'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.departmentId)); const documentId = computed(() => Number(route.params.documentId)); const query = useHrDocument(documentId)
// The owning list is fixed by this page's own route, so the return trip is
// literal and carries only the state the list was showing. A referrer's
// returnTo is dropped rather than forwarded: on the list URL it would nest one
// level deeper on every round trip and redirect that page's own controls.
const backTo = computed(() => {
  const { returnTo: _referrer, ...listQuery } = route.query
  return { path: '/hr/documents', query: listQuery }
})
const isEdit = computed(() => route.path.endsWith('/edit'))
</script>
<template>
  <SharedPageContainer v-if="!isEdit" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('hr.docs.title')" :description="query.data.value?.department.name" :back-to="backTo">
      <UButton v-if="query.data.value && can('hr.documents.manage')" color="primary" :disabled="!hydrated" :to="`/hr/departments/${id}/documents/${documentId}/edit`" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <UCard v-if="query.data.value" class="nasq-ui-record-surface" :ui="{ header: 'nasq-ui-card-header' }">
        <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.docs.body') }}</h2></template>
        <DocumentReader :document="query.data.value" hide-title />
      </UCard>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
