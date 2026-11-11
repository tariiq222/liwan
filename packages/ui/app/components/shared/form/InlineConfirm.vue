<script setup lang="ts">
// The one inline confirmation for destructive or irreversible actions
// (DESIGN.md: explicit inline confirmation, never a stacked dialog). Cancel
// always comes first and the action second.
// Focus: when it appears it takes focus (the first enabled field of its slot, else
// Cancel, the safe default for a destructive action). It is inline, not an overlay,
// so there is no trap. Cancel hands focus back to the control that was focused when
// it opened, provided that control is in the page again.
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
const cancelButton = useTemplateRef<{ $el: HTMLElement }>('cancelButton')
const fields = useTemplateRef<HTMLElement>('fields')
const opener = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null

onMounted(() => {
  const field = fields.value?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled)')
  const target = field ?? cancelButton.value?.$el
  target?.focus()
})

function cancel() {
  emit('cancel')
  nextTick(() => { if (opener?.isConnected) opener.focus() })
}
</script>

<template>
  <UAlert role="alert" :color="props.color" variant="subtle" :title="props.title" :description="props.description" data-testid="inline-confirm">
    <template v-if="$slots.default" #description>
      <p v-if="props.description">{{ props.description }}</p>
      <div ref="fields"><slot /></div>
    </template>
    <template #actions>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton ref="cancelButton" type="button" color="neutral" variant="outline" :disabled="!hydrated || props.pending" :label="props.cancelLabel ?? t('app.cancel')" data-testid="inline-confirm-cancel" @click="cancel" />
        <UButton type="button" :color="props.color" :disabled="!hydrated || props.disabled" :loading="props.pending" :label="props.confirmLabel" data-testid="inline-confirm-action" @click="emit('confirm')" />
      </div>
    </template>
  </UAlert>
</template>
