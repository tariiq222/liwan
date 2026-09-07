<script setup lang="ts">
import { toast } from 'vue-sonner'
import { ApiError } from '@/composables/useApi'
import { useCreateDocument } from '@/composables/useHrDocuments'
import DocumentEditor from './DocumentEditor.vue'

const props = defineProps<{ departmentId: number; backTo: string }>()
const emit = defineEmits<{ saved: [id: number] }>()
const { t } = useI18n()
const hydrated = useHydrated()
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
    toast.error(error instanceof ApiError ? error.message : t('errors.generic'))
  }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <form class="nasq-form" @submit.prevent="submit">
    <SharedFormSection :title="t('hr.docs.newTitle')">
      <div class="nasq-form-grid mt-4">
        <div class="grid gap-2"><Label for="hr-doc-new-name">{{ t('hr.docs.newTitle') }}</Label><Input id="hr-doc-new-name" v-model="name" :disabled="!hydrated || isPending" required /></div>
        <div class="grid gap-2 sm:col-span-2"><Label>{{ t('hr.docs.body') }}</Label><DocumentEditor :model-value="body" :document-id="0" :debounce="false" :disabled="isPending" @update:model-value="body = $event" /></div>
      </div>
    </SharedFormSection>
    <div class="nasq-form-footer"><NuxtLink :to="props.backTo"><Button type="button" variant="outline">{{ t('app.cancel') }}</Button></NuxtLink><Button type="submit" :disabled="!hydrated || isPending || !name.trim()">{{ t('app.create') }}</Button></div>
  </form>
</template>
