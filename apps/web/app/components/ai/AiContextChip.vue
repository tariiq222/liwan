<script setup lang="ts">
// The page the conversation was opened from (`?context=<page>:<id>`), shown as a quiet read-only chip.
const props = defineProps<{ page: string }>()
const { t, te } = useI18n()
const pageLabel = computed(() => (te(`ai.context.pages.${props.page}`) ? t(`ai.context.pages.${props.page}`) : props.page))
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1.5 rounded-full bg-elevated px-3 py-1 text-xs text-muted" data-testid="ai-context">
    <UIcon name="i-lucide-map-pin" aria-hidden="true" class="size-3.5 shrink-0" />
    <span class="truncate">{{ t('ai.context.chip', { page: pageLabel }) }}</span>
  </span>
</template>
