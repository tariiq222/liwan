<script setup lang="ts">
const props = defineProps<{
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
}>()
const { t } = useI18n()
</script>

<template>
  <article
    :data-role="props.role"
    :aria-busy="props.streaming || undefined"
    class="flex max-w-full flex-col gap-1 rounded-lg p-3 ring ring-default sm:max-w-[85%]"
    :class="props.role === 'user' ? 'bg-elevated self-start' : 'bg-default self-end'"
  >
    <p class="text-xs font-medium text-muted">{{ props.role === 'user' ? t('ai.thread.you') : t('ai.thread.assistant') }}</p>
    <p v-if="props.text" dir="auto" class="whitespace-pre-wrap break-words text-sm leading-6 text-highlighted">{{ props.text }}</p>
    <p v-if="props.streaming" class="text-xs text-muted">{{ t('ai.thread.thinking') }}</p>
  </article>
</template>
