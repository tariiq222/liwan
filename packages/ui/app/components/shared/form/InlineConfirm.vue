<script setup lang="ts">
// The one inline confirmation for destructive or irreversible actions
// (DESIGN.md: explicit inline confirmation, never a stacked dialog). Cancel
// always comes first and the action second.
const props = withDefaults(defineProps<{
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  pending?: boolean
  disabled?: boolean
  color?: 'error' | 'warning' | 'primary'
}>(), { color: 'error' })
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <UAlert role="alert" :color="props.color" variant="subtle" :title="props.title" :description="props.description" data-testid="inline-confirm">
    <template v-if="$slots.default" #description>
      <p v-if="props.description">{{ props.description }}</p>
      <slot />
    </template>
    <template #actions>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || props.pending" :label="props.cancelLabel ?? t('app.cancel')" data-testid="inline-confirm-cancel" @click="emit('cancel')" />
        <UButton type="button" :color="props.color" :disabled="!hydrated || props.disabled" :loading="props.pending" :label="props.confirmLabel" data-testid="inline-confirm-action" @click="emit('confirm')" />
      </div>
    </template>
  </UAlert>
</template>
