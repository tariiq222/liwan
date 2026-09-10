<script setup lang="ts">
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const id = computed(() => Number(route.params.departmentId)); const { can } = useAccess()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/departments/${id.value}`, ['/hr']))
function saved(documentId: number) { void navigateTo({ path: `/hr/departments/${id.value}/documents/${documentId}`, query: returnToQuery(returnTo.value) }) }
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('hr.docs.new')" :back-to="returnTo" />
    <SharedPageState v-if="!can('hr.documents.manage')" :empty="true" :empty-text="t('errors.forbidden')" />
    <section v-else class="nasq-panel nasq-panel-body"><DocumentCreateForm :department-id="id" :back-to="returnTo" @saved="saved" /></section>
  </SharedPageContainer>
</template>
