<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { ApiError } from '@/composables/useApi'
import { useCreateDocument } from '@/composables/useDocuments'
import DocumentEditor from './DocumentEditor.vue'
import DocumentMetadataFields from './DocumentMetadataFields.vue'
const props = defineProps<{ initialContext?: { kind: string; id: number } | null; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n(); const hydrated = useHydrated(); const toast = useToast()
const name = ref(''); const body = ref(''); const expiry = ref<string | null>(null); const context = ref(props.initialContext ?? null); const tags = ref<number[]>([])
const nameInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const saved = ref(false); const attempted = ref(false); const error = ref('')
const titleError = computed(() => attempted.value && !name.value.trim() ? t('documents.titleRequired') : undefined)
const mutation = useCreateDocument()
const contextChanged = computed(() => (context.value?.kind ?? null) !== (props.initialContext?.kind ?? null) || (context.value?.id ?? null) !== (props.initialContext?.id ?? null))
const dirty = computed(() => !saved.value && (!!name.value.trim() || !!body.value || !!expiry.value || tags.value.length > 0 || contextChanged.value))
async function submit() {
  if (!hydrated.value || mutation.isPending.value) return
  attempted.value = true; error.value = ''
  if (!name.value.trim()) { await nextTick(); nameInput.value?.inputRef?.focus(); return }
  try {
    const document = await mutation.mutateAsync({ name: name.value.trim(), body: body.value, expiry_date: expiry.value || null, context: context.value, tag_ids: tags.value })
    saved.value = true; toast.add({ title: t('documents.created'), color: 'success' }); await nextTick(); emit('saved', document.id)
  } catch (cause) { error.value = cause instanceof ApiError ? cause.message : t('errors.generic') }
}
</script>
<template>
  <SharedUnsavedChanges :dirty="dirty || mutation.isPending.value" />
  <UForm novalidate :loading-auto="false" :state="{ name, body }" class="liwan-form" @submit="submit">
    <UAlert v-if="error" color="error" variant="subtle" :title="error" />
    <UAlert color="info" variant="subtle" :title="t('documents.restrictedDefault')" :description="t('documents.visibilityHelp.restricted')" />
    <SharedFormSection panel :title="t('documents.documentInfo')">
      <div class="grid gap-(--liwan-gap-card)">
        <UFormField :label="t('documents.columns.name')" name="document-name" required :error="titleError"><UInput ref="nameInput" id="document-name" v-model="name" class="w-full" :disabled="!hydrated || mutation.isPending.value" required /></UFormField>
        <UFormField :label="t('documents.body')" name="document-body" :help="t('documents.bodyHelp')"><DocumentEditor v-model="body" :document-id="0" :debounce="false" :disabled="!hydrated || mutation.isPending.value" /></UFormField>
        <p class="text-sm text-muted">{{ t('documents.createFilesHelp') }}</p>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('documents.optionalDetails')" :description="t('documents.optionalDetailsHelp')">
      <div class="grid gap-(--liwan-gap-card)"><DocumentMetadataFields v-model:expiry="expiry" v-model:context="context" v-model:tags="tags" :disabled="mutation.isPending.value" /></div>
    </SharedFormSection>
    <SharedFormActions><div class="ms-auto flex gap-2"><UButton type="button" color="neutral" variant="outline" :to="backTo" :label="t('app.cancel')" :disabled="mutation.isPending.value" /><UButton type="submit" icon="i-lucide-plus" :label="t('documents.create')" :disabled="!hydrated" :loading="mutation.isPending.value" /></div></SharedFormActions>
  </UForm>
</template>
