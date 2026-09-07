<script setup lang="ts">
import DocumentReader from '@/components/hr/DocumentReader.vue'
import { useHrDocument } from '@/composables/useHrDocuments'
import { returnToQuery, safeReturnTo } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const id = computed(() => Number(route.params.departmentId)); const documentId = computed(() => Number(route.params.documentId)); const query = useHrDocument(documentId)
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/departments/${id.value}`, ['/hr']))
const isEdit = computed(() => route.path.endsWith('/edit'))
</script>
<template><div class="nasq-page-stack mx-auto w-full max-w-5xl"><SharedPageHeader v-if="!isEdit" :title="query.data.value?.name || t('hr.docs.title')" :back-to="returnTo"><NuxtLink v-if="query.data.value && can('hr.documents.manage')" :to="{ path: `/hr/departments/${id}/documents/${documentId}/edit`, query: returnToQuery(route.fullPath) }"><Button>{{ t('app.edit') }}</Button></NuxtLink></SharedPageHeader><SharedPageState v-if="!isEdit" :loading="query.isLoading.value" :error="query.error.value" :empty="!query.data.value" @retry="query.refetch"><section v-if="query.data.value" class="nasq-panel nasq-panel-body"><DocumentReader :document="query.data.value" hide-title /></section></SharedPageState><NuxtPage /></div></template>
