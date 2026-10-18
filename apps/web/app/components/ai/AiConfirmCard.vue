<script setup lang="ts">
// Only the newest pending card of a thread is the page's one `action` block; an older pending one is `tinted`.
const props = withDefaults(defineProps<{
  summary: string
  state: 'pending' | 'approved' | 'rejected'
  latest?: boolean
  disabled?: boolean
  /** Why the card cannot be answered now (an earlier request is still executing it). */
  note?: string
}>(), { latest: true })
const emit = defineEmits<{ approve: []; reject: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <SharedRecordSection v-if="props.state === 'pending'" :variant="props.latest ? 'action' : 'tinted'" :title="t('ai.confirm.title')" role="alert" data-testid="ai-confirm">
    <p class="break-words text-sm text-highlighted">{{ props.note ? `${props.summary} — ${props.note}` : props.summary }}</p>
    <div class="mt-3 flex w-full flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || props.disabled" :label="t('ai.confirm.reject')" data-testid="inline-confirm-cancel" @click="emit('reject')" />
      <UButton type="button" :disabled="!hydrated || props.disabled" :loading="props.disabled" :label="t('ai.confirm.approve')" data-testid="inline-confirm-action" @click="emit('approve')" />
    </div>
  </SharedRecordSection>
  <AiResolvedLine v-else :summary="props.summary" :state="props.state" data-testid="ai-confirm" />
</template>
