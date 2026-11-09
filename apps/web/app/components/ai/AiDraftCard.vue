<script setup lang="ts">
// Only the newest pending card of a thread is the page's one `action` block; an older pending one is `tinted`.
const props = withDefaults(defineProps<{
  summary: string
  state: 'pending' | 'approved' | 'rejected'
  latest?: boolean
}>(), { latest: true })
const emit = defineEmits<{ open: []; discard: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <SharedRecordSection v-if="props.state === 'pending'" :variant="props.latest ? 'action' : 'tinted'" :title="t('ai.draft.title')" data-testid="ai-draft">
    <p class="break-words text-sm text-highlighted">{{ props.summary }}</p>
    <p class="mt-1 text-sm text-muted">{{ t('ai.draft.hint') }}</p>
    <div class="mt-3 flex w-full flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :label="t('ai.draft.discard')" data-testid="ai-draft-discard" @click="emit('discard')" />
      <UButton type="button" :disabled="!hydrated" :label="t('ai.draft.open')" data-testid="ai-draft-open" @click="emit('open')" />
    </div>
  </SharedRecordSection>
  <AiResolvedLine v-else :summary="props.summary" :state="props.state" data-testid="ai-draft" />
</template>
