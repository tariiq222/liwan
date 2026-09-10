<script setup lang="ts">
import DocumentReader from '@/components/hr/DocumentReader.vue'
import { useHrDocument } from '@/composables/useHrDocuments'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated(); const id = computed(() => Number(route.params.departmentId)); const documentId = computed(() => Number(route.params.documentId)); const query = useHrDocument(documentId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/departments/${id.value}`, ['/hr']))
const isEdit = computed(() => route.path.endsWith('/edit'))
</script>
<template>
  <SharedPageContainer v-if="!isEdit" width="detail">
    <SharedPageHeader :title="query.data.value?.name || t('hr.docs.title')" :description="query.data.value?.department.name" :back-to="returnTo">
      <Button v-if="query.data.value && can('hr.documents.manage')" as-child :disabled="!hydrated"><NuxtLink :to="{ path: `/hr/departments/${id}/documents/${documentId}/edit`, query: returnToQuery(route.fullPath) }" @click="!hydrated && $event.preventDefault()">{{ t('app.edit') }}</NuxtLink></Button>
    </SharedPageHeader>
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch">
      <SharedFormSection v-if="query.data.value" panel :title="t('hr.docs.body')">
        <DocumentReader :document="query.data.value" hide-title />
      </SharedFormSection>
    </SharedPageState>
  </SharedPageContainer>
  <NuxtPage v-else />
</template>
