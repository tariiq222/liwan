<script setup lang="ts">
import { hrDocumentBack, hrDocumentContext } from '@/utils/hrReturnTo'
import DocumentReader from '@/components/hr/DocumentReader.vue'
import { useHrDocument } from '@/composables/useHrDocuments'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.departmentId)); const documentId = computed(() => Number(route.params.documentId)); const query = useHrDocument(documentId)
const backTo = computed(() => hrDocumentBack(route.query, id.value, route.hash))
const editTo = computed(() => ({ path: `/hr/departments/${id.value}/documents/${documentId.value}/edit`, query: hrDocumentContext(route.query, id.value), ...(route.hash ? { hash: route.hash } : {}) }))
const isEdit = computed(() => route.path.endsWith('/edit'))
</script>
<template>
  <SharedPageContainer v-if="!isEdit" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('hr.docs.title')" :description="query.data.value?.department.name" :back-to="backTo">
      <UButton v-if="query.data.value && can('hr.documents.manage')" color="primary" :disabled="!hydrated" :to="editTo" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <UCard v-if="query.data.value" class="rounded-lg ring ring-default bg-default overflow-hidden" :ui="{ header: '' }">
        <template #header><h2 class="text-lg font-semibold text-highlighted">{{ t('hr.docs.body') }}</h2></template>
        <DocumentReader :document="query.data.value" hide-title />
      </UCard>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
