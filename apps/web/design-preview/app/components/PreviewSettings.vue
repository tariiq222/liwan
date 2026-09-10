<script setup lang="ts">
import { useHydrated } from '#nasq-composables/useHydrated'
const { t, canEdit } = usePreview()
const toast = useToast()
const settings = useState('design-workspace-settings', () => ({ name: 'Nasq', notifications: true }))
const form = reactive({ ...settings.value })
const initial = ref(JSON.stringify(form))
const dirty = computed(() => JSON.stringify(form) !== initial.value)
const ready = useHydrated()
function save() {
  if (!canEdit.value || !ready.value) return
  settings.value = { ...form }
  initial.value = JSON.stringify(form)
  toast.add({ title: t('settingsSaved'), description: t('savedHint'), color: 'success' })
}
</script>
<template>
  <UForm :state="form" :validate="value => value.name.trim() ? [] : [{ name: 'name', message: t('required') }]" :disabled="!canEdit || !ready" class="preview-form" method="post" @submit="save">
    <UCard>
      <template #header><h2 class="preview-section-title">{{ t('basic') }}</h2></template>
      <UFormField name="name" :label="t('workspaceName')" required><UInput v-model="form.name" class="w-full max-w-lg" /></UFormField>
    </UCard>
    <UCard>
      <template #header><h2 class="preview-section-title">{{ t('notifications') }}</h2></template>
      <USwitch v-model="form.notifications" :label="t('notifications')" :description="t('notificationsHint')" />
    </UCard>
    <footer class="preview-form-footer"><UButton type="button" :label="t('cancel')" color="secondary" @click="Object.assign(form, settings)" /><UButton type="submit" :label="t('save')" :disabled="!canEdit || !ready" /></footer>
  </UForm>
  <PreviewUnsavedChanges :dirty="dirty" />
</template>
