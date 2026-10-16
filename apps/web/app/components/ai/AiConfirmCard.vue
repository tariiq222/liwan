<script setup lang="ts">
const props = defineProps<{
  summary: string
  state: 'pending' | 'approved' | 'rejected'
  disabled?: boolean
  /** Why the card cannot be answered now (an earlier request is still executing it). */
  note?: string
}>()
const emit = defineEmits<{ approve: []; reject: [] }>()
const { t } = useI18n()
</script>

<template>
  <SharedInlineConfirm
    v-if="props.state === 'pending'"
    :title="t('ai.confirm.title')"
    :description="props.note ? `${props.summary} — ${props.note}` : props.summary"
    :confirm-label="t('ai.confirm.approve')"
    :cancel-label="t('ai.confirm.reject')"
    :disabled="props.disabled"
    :pending="props.disabled"
    color="primary"
    data-testid="ai-confirm"
    @confirm="emit('approve')"
    @cancel="emit('reject')"
  />
  <p v-else :data-state="props.state" class="flex items-center gap-2 text-sm text-muted" data-testid="ai-confirm">
    <UIcon :name="props.state === 'approved' ? 'i-lucide-check' : 'i-lucide-x'" aria-hidden="true" class="size-4 shrink-0" />
    <span class="min-w-0 break-words">{{ props.summary }} — {{ t(props.state === 'approved' ? 'ai.confirm.approved' : 'ai.confirm.rejected') }}</span>
  </p>
</template>
