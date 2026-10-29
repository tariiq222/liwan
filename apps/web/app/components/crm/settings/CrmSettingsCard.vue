<script setup lang="ts">
// The frame of one settings card: title, the save/conflict feedback and the save button. The card's fields go in the slot.
defineProps<{
  title: string
  description: string
  canEdit: boolean
  dirty: boolean
  saving: boolean
  reloading: boolean
  conflict: boolean
  message: string
  reloadFailed: boolean
  saveLabel?: string
}>()
defineEmits<{ save: []; reload: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <UForm novalidate :state="{}" class="webvue-form" method="post" @submit="$emit('save')">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="title" :description="description">
      <UAlert v-if="message" role="alert" color="error" variant="subtle" :title="t('crm.settings.saveError')" :description="message" />
      <UButton v-if="conflict" type="button" color="neutral" variant="outline" :label="t('crm.settings.reload')" :loading="reloading" :disabled="!hydrated || reloading" @click="$emit('reload')" />
      <UAlert v-if="reloadFailed" role="alert" color="error" variant="subtle" :title="t('crm.settings.reloadError')" />
      <slot />
    </SharedFormSection>
    <SharedFormActions v-if="canEdit">
      <UButton type="submit" class="ms-auto" :loading="saving" :disabled="!hydrated || saving || reloading || !dirty || conflict" :label="saveLabel ?? t('app.saveChanges')" />
    </SharedFormActions>
  </UForm>
</template>
