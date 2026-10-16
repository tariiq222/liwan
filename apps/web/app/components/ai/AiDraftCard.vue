<script setup lang="ts">
const props = defineProps<{
  summary: string
  state: 'pending' | 'approved' | 'rejected'
}>()
const emit = defineEmits<{ open: []; discard: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <UAlert
    v-if="props.state === 'pending'"
    color="primary"
    variant="subtle"
    icon="i-lucide-file-pen-line"
    :title="t('ai.draft.title')"
    data-testid="ai-draft"
  >
    <template #description>
      <p class="break-words text-highlighted">{{ props.summary }}</p>
      <p class="mt-1">{{ t('ai.draft.hint') }}</p>
    </template>
    <template #actions>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated" :label="t('ai.draft.discard')" data-testid="ai-draft-discard" @click="emit('discard')" />
        <UButton type="button" :disabled="!hydrated" :label="t('ai.draft.open')" data-testid="ai-draft-open" @click="emit('open')" />
      </div>
    </template>
  </UAlert>
  <p v-else :data-state="props.state" class="flex items-center gap-2 text-sm text-muted" data-testid="ai-draft">
    <UIcon :name="props.state === 'approved' ? 'i-lucide-check' : 'i-lucide-x'" aria-hidden="true" class="size-4 shrink-0" />
    <span class="min-w-0 break-words">{{ props.summary }} — {{ t(props.state === 'approved' ? 'ai.confirm.approved' : 'ai.confirm.rejected') }}</span>
  </p>
</template>
