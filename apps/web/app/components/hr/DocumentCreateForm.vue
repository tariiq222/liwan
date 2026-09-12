<script setup lang="ts">
import { ApiError } from '@/composables/useApi'
import { useCreateDocument } from '@/composables/useHrDocuments'
import DocumentEditor from './DocumentEditor.vue'

const props = defineProps<{ departmentId: number; backTo: string }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const name = ref('')
const body = ref('')
const saved = ref(false)
const { mutateAsync: create, isPending } = useCreateDocument()
const dirty = computed(() => !saved.value && (!!name.value.trim() || !!body.value))

async function submit() {
  const title = name.value.trim()
  if (!hydrated.value || !title) return
  try {
    const document = await create({ name: title, body: body.value, department_id: props.departmentId })
    saved.value = true
    await nextTick()
    emit('saved', document.id)
  } catch (error) {
    toast.add({ title: error instanceof ApiError ? error.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, body }" class="nasq-form" method="post" @submit="submit">
    <SharedFormSection :title="t('hr.docs.newTitle')">
      <div class="grid gap-4 mt-4">
        <UFormField :label="t('hr.docs.newTitle')" name="hr-doc-new-name" required>
          <UInput id="hr-doc-new-name" v-model="name" class="w-full" :disabled="!hydrated || isPending" required />
        </UFormField>
        <UFormField :label="t('hr.docs.body')" name="hr-doc-new-body">
          <DocumentEditor :model-value="body" :document-id="0" :debounce="false" :disabled="isPending" @update:model-value="body = $event" />
        </UFormField>
      </div>
    </SharedFormSection>
    <footer class="nasq-form-footer justify-end">
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || isPending || !name.trim()" :label="t('app.create')" />
    </footer>
  </UForm>
</template>
