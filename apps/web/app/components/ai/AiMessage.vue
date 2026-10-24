<script setup lang="ts">
import { parseMarkdown } from '@/utils/aiMarkdown'
import { renderMarkdownBlocks } from '@/utils/aiMarkdownRender'

// One message of the thread, shared by the full page and the sheet (`compact` is the sheet's smaller type).
// The user's message is a tinted bubble on the inline-start side; the assistant's answer is plain text beside its mark,
// with the `footer` slot (sources, copy) under the text.
const props = defineProps<{
  role: 'user' | 'assistant'
  text: string
  streaming?: boolean
  compact?: boolean
}>()
const { t } = useI18n()
// Only the assistant writes markdown; the user's own message stays exactly what they typed.
const blocks = computed(() => (props.role === 'assistant' ? parseMarkdown(props.text) : []))
const MarkdownBody = () => renderMarkdownBlocks(blocks.value)
const textClass = computed(() => (props.compact ? 'text-sm leading-6' : 'text-base leading-7'))
</script>

<template>
  <article
    :data-role="props.role"
    :aria-busy="props.streaming || undefined"
    :class="props.role === 'user' ? 'flex min-w-0 max-w-prose flex-col self-start' : 'flex min-w-0 items-start gap-3'"
  >
    <span class="sr-only">{{ props.role === 'user' ? t('ai.thread.you') : t('ai.thread.assistant') }}</span>
    <template v-if="props.role === 'user'">
      <p dir="auto" :class="['whitespace-pre-wrap break-words rounded-card bg-(--webvue-nav-active) px-4 py-2.5 text-highlighted', textClass]">{{ props.text }}</p>
    </template>
    <template v-else>
      <AiAvatar class="mt-0.5" />
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div v-if="props.text" :class="['flex min-w-0 flex-col gap-2 text-highlighted', textClass]"><MarkdownBody /></div>
        <AiTypingDots v-if="props.streaming" />
        <slot name="footer" />
      </div>
    </template>
  </article>
</template>
