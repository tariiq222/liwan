<script setup lang="ts">
import DocumentCreateForm from '@/components/hr/DocumentCreateForm.vue'
import { safeReturnTo, returnToQuery } from '@/utils/safeReturnTo'
const route = useRoute(); const { t } = useI18n(); const id = computed(() => Number(route.params.departmentId)); const { can } = useAccess()
const returnTo = computed(() => safeReturnTo(route.query.returnTo, `/hr/departments/${id.value}`, ['/hr']))
function saved(documentId: number) { void navigateTo({ path: `/hr/departments/${id.value}/documents/${documentId}`, query: returnToQuery(returnTo.value) }) }
</script>
<template><div class="mx-auto w-full max-w-5xl space-y-8"><SharedPageHeader :title="t('hr.docs.new')" :back-to="returnTo" /><SharedPageState v-if="!can('hr.documents.manage')" :empty="true" :empty-text="t('errors.forbidden')" /><section v-else class="rounded-lg border border-border/80 bg-card p-4 sm:p-6"><DocumentCreateForm :department-id="id" :back-to="returnTo" @saved="saved" /></section></div></template>
