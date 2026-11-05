<script setup lang="ts">
// A hand-over inside one conversation: from here on the named specialist agent answers.
const props = defineProps<{ name: string }>()
const { t } = useI18n()
</script>

<template>
  <p class="flex items-center gap-2 text-xs text-muted" data-testid="ai-handoff">
    <UIcon name="i-lucide-arrow-right-left" aria-hidden="true" class="size-3.5 shrink-0 rtl:-scale-x-100" />
    <span class="min-w-0 break-words">{{ t('ai.handoff', { agent: props.name }) }}</span>
  </p>
</template>
