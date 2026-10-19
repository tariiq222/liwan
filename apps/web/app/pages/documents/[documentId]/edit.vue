<script setup lang="ts">
import DocumentEditor from '@/components/documents/DocumentEditor.vue'
import DocumentMetadataFields from '@/components/documents/DocumentMetadataFields.vue'
import { ApiError } from '@/composables/useApi'
import { useDocument, useUpdateDocument } from '@/composables/useDocuments'
import { createDocumentDraft } from '@/lib/documentEditorDraft'
import { useSsrQuerySeed } from '@/lib/vueQuerySsr'
import { documentParentTo } from '@/lib/documentNavigation'
const route = useRoute(); const { t } = useI18n(); const hydrated = useHydrated(); const toast = useToast()
const id = computed(() => Number(route.params.documentId)); const query = useDocument(computed(() => Number.isSafeInteger(id.value) && id.value > 0 ? id.value : null))
const document = computed(() => query.data.value)
const backTo = computed(() => documentParentTo(`/documents/${id.value}`, route.query, route.hash))
const draft = reactive(createDocumentDraft()); const attempted = ref(false); const error = ref(''); const conflict = ref(false)
const update = useUpdateDocument()
const titleError = computed(() => attempted.value && !draft.name.trim() ? t('documents.titleRequired') : undefined)
function seed(value: typeof document.value) { if (value) draft.receive(value) }
watch(document, seed, { immediate: true }); useSsrQuerySeed(query, seed)
async function reload() { const result = await query.refetch(); if (result.data) { draft.reload(result.data); conflict.value = false; error.value = '' } }
async function save() {
  if (!document.value?.allowed_actions.update || !hydrated.value || update.isPending.value || conflict.value || !draft.isDirty()) return
  attempted.value = true; error.value = ''; if (!draft.name.trim()) return
  try { const saved = await update.mutateAsync({ id: id.value, patch: draft.patch() }); draft.reload(saved); toast.add({ title: t('documents.saved'), color: 'success' }); await nextTick(); await navigateTo(backTo.value) }
  catch (cause) { if (cause instanceof ApiError && cause.status === 409) { conflict.value = true; await query.refetch() } else error.value = cause instanceof ApiError ? cause.message : t('errors.generic') }
}
</script>
<template>
  <SharedPageContainer width="form">
    <SharedPageHeader :title="t('documents.edit')" :back-to="backTo" />
    <SharedPageState :loading="query.isLoading.value" :error="query.error.value" @retry="query.refetch">
      <SharedForbiddenState v-if="document && !document.allowed_actions.update" />
      <UForm v-else-if="document" :state="draft" class="webvue-form" @submit="save">
        <SharedUnsavedChanges :dirty="draft.isDirty() || update.isPending.value" />
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UAlert v-if="conflict" color="warning" :title="t('documents.conflict')" :description="t('documents.conflictHelp')"><template #actions><UButton type="button" color="neutral" :label="t('documents.reload')" :disabled="!hydrated || query.isFetching.value" @click="reload" /></template></UAlert>
        <SharedFormSection panel :title="t('documents.documentInfo')"><div class="grid gap-(--webvue-gap-card)">
          <UFormField :label="t('documents.columns.name')" name="document-name" required :error="titleError"><UInput id="document-name" v-model="draft.name" class="w-full" :disabled="!hydrated || update.isPending.value" /></UFormField>
          <UFormField :label="t('documents.body')" name="document-body" :help="t('documents.bodyHelp')"><DocumentEditor :key="`${draft.id}:${draft.revision}`" v-model="draft.body" :document-id="id" :debounce="false" :disabled="!hydrated || update.isPending.value" /></UFormField>

        </div></SharedFormSection>
        <SharedFormSection panel :title="t('documents.optionalDetails')" :description="t('documents.optionalDetailsHelp')"><div class="grid gap-(--webvue-gap-card)">
          <DocumentMetadataFields :known-tags="document.tags" :known-context="document.context" v-model:expiry="draft.expiry_date" v-model:context="draft.context" v-model:tags="draft.tag_ids" :disabled="update.isPending.value" />
        </div></SharedFormSection>
        <p class="text-sm text-muted">{{ t('documents.editFilesHelp') }}</p>
        <SharedFormActions><div class="ms-auto flex gap-2"><UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" :disabled="update.isPending.value" /><UButton type="submit" :label="t('app.saveChanges')" :loading="update.isPending.value" :disabled="!hydrated || conflict || !draft.isDirty()" /></div></SharedFormActions>
      </UForm>
    </SharedPageState>
  </SharedPageContainer>
</template>
