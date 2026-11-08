<script setup lang="ts">
import { ASSISTANT_PANEL, slideOverId } from '@/composables/useSlideOver'
import { useAssistantSheet } from '@/composables/useAssistantSheet'

// The top-bar button that opens the assistant panel: the black sparkles button with the surface's label (the label
// drops out below 1380px). It is absent for a user who may not use the assistant and on the assistant's own full page.
const { t } = useI18n()
const hydrated = useHydrated()
const sheet = useAssistantSheet()
const label = computed(() => (sheet.surface.value ? t(sheet.surface.value.labelKey) : ''))
</script>

<template>
  <button
    v-if="sheet.showButton.value"
    type="button"
    class="liwan-ai-button"
    data-slide-over-trigger
    data-testid="assistant-button"
    :disabled="!hydrated"
    :aria-label="label"
    :aria-expanded="sheet.shown.value"
    :aria-controls="slideOverId(ASSISTANT_PANEL)"
    aria-haspopup="dialog"
    :data-open="sheet.shown.value ? 'true' : undefined"
    @click="sheet.toggle($event.currentTarget as HTMLElement)"
  >
    <UIcon name="i-lucide-sparkles" class="size-4.5" aria-hidden="true" />
    <span data-slot="label">{{ label }}</span>
  </button>
</template>
