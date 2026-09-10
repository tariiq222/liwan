<script setup lang="ts">
import type { FormError, FormErrorEvent } from '@nuxt/ui'
import { useHydrated } from '#nasq-composables/useHydrated'
import type { PreviewRecord, PreviewStatus } from '../composables/usePreview'
const props = defineProps<{ record?: PreviewRecord }>()
const emit = defineEmits<{ saved: [id: number]; cancel: [] }>()
const { t, items, records, module, titleOf, canEdit } = usePreview()
const toast = useToast()
const form = reactive({
  title: props.record ? titleOf(props.record) : '', owner: props.record?.owner || 'sara',
  due: props.record?.due || '', state: props.record?.state || 'waiting' as PreviewStatus,
  progress: props.record?.progress || 0, description: props.record?.description || '',
})
const initial = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== initial.value)
const saving = ref(false)
const ready = useHydrated()
const simulateError = ref(false)
const saveError = ref(false)
const ownerOptions = computed(() => ['sara', 'omar', 'noura'].map(value => ({ value, label: t(`people.${value}`) })))
const statusOptions = computed(() => ['active', 'done', 'waiting'].map(value => ({ value, label: t(value) })))
function validate(state: typeof form): FormError[] {
  return state.title.trim() ? [] : [{ name: 'title', message: t('required') }]
}
function focusError(event: FormErrorEvent) {
  const id = event.errors[0]?.id
  if (id) document.getElementById(id)?.focus()
}
async function save() {
  if (!ready.value || saving.value || !canEdit.value) return
  saving.value = true
  saveError.value = false
  await new Promise(resolve => setTimeout(resolve, 180))
  if (simulateError.value) { saveError.value = true; saving.value = false; return }
  const id = props.record?.id || Math.max(...items.value.map(item => item.id)) + 1
  const saved = { ...form, title: form.title.trim(), id }
  records.value[module.value] = props.record ? items.value.map(item => item.id === id ? saved : item) : [...items.value, saved]
  initial.value = JSON.stringify(form)
  saving.value = false
  toast.add({ title: t('saved'), description: t('savedHint'), color: 'success', icon: 'i-lucide-circle-check' })
  await nextTick()
  emit('saved', id)
}
</script>
<template>
  <UForm :state="form" :validate="validate" :disabled="saving || !canEdit || !ready" class="preview-form" method="post" @submit="save" @error="focusError">
    <section class="preview-form-section">
      <div><h2 class="preview-section-title">{{ t('basic') }}</h2><p class="text-sm text-muted mt-1">{{ t('basicHint') }}</p></div>
      <UFormField :label="t('title')" name="title" required><UInput v-model="form.title" class="w-full" autocomplete="off" /></UFormField>
      <UFormField :label="t('description')" name="description"><UTextarea v-model="form.description" class="w-full" :rows="4" /></UFormField>
    </section>
    <section class="preview-form-section">
      <div><h2 class="preview-section-title">{{ t('followup') }}</h2><p class="text-sm text-muted mt-1">{{ t('followupHint') }}</p></div>
      <div class="grid sm:grid-cols-2 gap-5">
        <UFormField :label="t('owner')" name="owner"><USelect v-model="form.owner" :items="ownerOptions" class="w-full" /></UFormField>
        <UFormField :label="t('due')" name="due">
          <PreviewDateField v-model="form.due" :label="t('due')" :disabled="saving || !canEdit || !ready" />
        </UFormField>
        <UFormField :label="t('status')" name="state"><USelect v-model="form.state" :items="statusOptions" class="w-full" /></UFormField>
        <UFormField :label="t('progress')" name="progress"><UInputNumber v-model="form.progress" :min="0" :max="100" class="w-full" /></UFormField>
      </div>
    </section>
    <UCheckbox v-model="simulateError" :label="t('simulateError')" />
    <UAlert v-if="saveError" role="alert" color="error" variant="subtle" :title="t('saveError')" :description="t('saveErrorHint')" icon="i-lucide-circle-alert" />
    <footer class="preview-form-footer">
      <UButton type="button" color="secondary" :label="t('cancel')" :disabled="saving" @click="emit('cancel')" />
      <UButton type="submit" :label="t('save')" :loading="saving" :disabled="!ready || !canEdit" />
    </footer>
  </UForm>
  <PreviewUnsavedChanges :dirty="dirty" />
</template>
