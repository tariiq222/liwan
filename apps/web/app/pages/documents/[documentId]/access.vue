<script setup lang="ts">
import DocumentAccessForm from '@/components/documents/DocumentAccessForm.vue'
import { ApiError } from '@/composables/useApi'
import { useDocument, useDocumentAccess, useUpdateDocumentAccess } from '@/composables/useDocuments'
import { documentParentTo } from '@/lib/documentNavigation'
import type { DocumentAccessUpdate } from '@webvue/contracts'
const route = useRoute(); const { t } = useI18n(); const toast = useToast(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.documentId)); const document = useDocument(computed(() => Number.isSafeInteger(id.value) && id.value > 0 ? id.value : null))
const query = useDocumentAccess(id, computed(() => !!document.data.value?.allowed_actions.manage_access)); const mutation = useUpdateDocumentAccess()
const backTo = computed(() => documentParentTo(`/documents/${id.value}`, route.query, route.hash))
const error = ref(''); const conflict = ref(false); const formKey = ref(0)
async function reload() { const result = await query.refetch(); if (result.data) { conflict.value = false; error.value = ''; formKey.value++ } }
async function save(body: DocumentAccessUpdate) {
  if (!hydrated.value || mutation.isPending.value || conflict.value) return
  error.value = ''
  try { await mutation.mutateAsync({ id: id.value, body }); toast.add({ title: t('documents.saved'), color: 'success' }); formKey.value++ }
  catch (cause) { if (cause instanceof ApiError && cause.status === 409) { conflict.value = true; await query.refetch() } else error.value = cause instanceof ApiError ? cause.message : t('errors.generic') }
}
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('documents.access')" :back-to="backTo" />
    <SharedPageState :loading="document.isLoading.value || (document.data.value?.allowed_actions.manage_access && query.isLoading.value)" :error="document.error.value || query.error.value" @retry="document.refetch(); query.refetch()">
      <SharedForbiddenState v-if="document.data.value && !document.data.value.allowed_actions.manage_access" />
      <DocumentAccessForm v-else-if="query.data.value" :key="formKey" :access="query.data.value" :back-to="backTo" :pending="mutation.isPending.value" :error="error" :conflict="conflict" @save="save" @reload="reload" />
    </SharedPageState>
  </SharedPageContainer>
</template>
