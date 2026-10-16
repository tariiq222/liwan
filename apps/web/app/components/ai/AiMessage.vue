<script setup lang="ts">
import { parseMarkdown } from '@/utils/aiMarkdown'
import { renderMarkdownBlocks } from '@/utils/aiMarkdownRender'

const props = defineProps<{
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
}>()
const { t } = useI18n()
// Only the assistant writes markdown; the user's own message stays exactly what they typed.
const blocks = computed(() => (props.role === 'assistant' ? parseMarkdown(props.text) : []))
const MarkdownBody = () => renderMarkdownBlocks(blocks.value)
</script>

<template>
  <article
    :data-role="props.role"
    :aria-busy="props.streaming || undefined"
    class="flex max-w-full min-w-0 flex-col gap-1 rounded-lg p-3 ring ring-default sm:max-w-[85%]"
    :class="props.role === 'user' ? 'bg-elevated self-start' : 'bg-default self-end'"
  >
    <p class="text-xs font-medium text-muted">{{ props.role === 'user' ? t('ai.thread.you') : t('ai.thread.assistant') }}</p>
    <template v-if="props.text">
      <p v-if="props.role === 'user'" dir="auto" class="whitespace-pre-wrap break-words text-sm leading-6 text-highlighted">{{ props.text }}</p>
      <div v-else class="flex min-w-0 flex-col gap-2 text-sm leading-6 text-highlighted"><MarkdownBody /></div>
    </template>
    <p v-if="props.streaming" class="text-xs text-muted">{{ t('ai.thread.thinking') }}</p>
  </article>
</template>
