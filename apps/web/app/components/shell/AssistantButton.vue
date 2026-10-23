<script setup lang="ts">
import { ASSISTANT_SHEET_ID, useAssistantSheet } from '@/composables/useAssistantSheet'

// The header button that opens the assistant sheet: a pill with the assistant mark and the surface's label (icon
// only below 768px). It is absent for a user who may not use the assistant and on the assistant's own full page.
const { t } = useI18n()
const hydrated = useHydrated()
const sheet = useAssistantSheet()
const label = computed(() => (sheet.surface.value ? t(sheet.surface.value.labelKey) : ''))
</script>

<template>
  <button
    v-if="sheet.showButton.value"
    type="button"
    class="webvue-assistant-button"
    data-testid="assistant-button"
    :disabled="!hydrated"
    :aria-label="label"
    :aria-expanded="sheet.shown.value"
    :aria-controls="ASSISTANT_SHEET_ID"
    :data-open="sheet.shown.value ? 'true' : undefined"
    @click="sheet.toggle($event.currentTarget as HTMLElement)"
  >
    <span class="webvue-assistant-button-mark" aria-hidden="true"><UIcon name="i-lucide-sparkles" class="size-4" /></span>
    <span class="webvue-assistant-button-label">{{ label }}</span>
  </button>
</template>
