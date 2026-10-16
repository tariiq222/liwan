<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useCreateDocument } from '@/composables/useHrDocuments'
import DocumentEditor from './DocumentEditor.vue'
import type { RouteLocationRaw } from 'vue-router'

const props = defineProps<{ departmentId: number; backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref('')
const body = ref('')
const saved = ref(false)
const attempted = ref(false)
const error = ref('')
const titleError = computed(() => attempted.value && !name.value.trim() ? t('hr.docs.titleRequired') : undefined)
const { mutateAsync: create, isPending } = useCreateDocument()
const dirty = computed(() => !saved.value && (!!name.value.trim() || !!body.value))

async function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  error.value = ''
  const title = name.value.trim()
  if (!title) return
  try {
    const document = await create({ name: title, body: body.value, department_id: props.departmentId })
    saved.value = true
    await nextTick()
    emit('saved', document.id)
  } catch (cause) {
    error.value = cause instanceof ApiError ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm novalidate :state="{ name, body }" class="nasq-form" method="post" @submit="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" :title="error" />
    <SharedFormSection :title="t('hr.docs.newTitle')">
      <div class="grid gap-4 mt-4">
        <UFormField :label="t('hr.docs.newTitle')" name="hr-doc-new-name" required :error="titleError">
          <UInput id="hr-doc-new-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" required />
        </UFormField>
        <UFormField :label="t('hr.docs.body')" name="hr-doc-new-body">
          <DocumentEditor :model-value="body" :document-id="0" :debounce="false" :disabled="isPending" @update:model-value="body = $event" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions class="justify-end">
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('app.create')" />
    </SharedFormActions>
  </UForm>
</template>
