<script setup lang="ts">
import { sanitizeHtml } from '@/utils/sanitize'

// The one renderer for stored rich text (task descriptions, meeting agenda and
// minutes, resolution results, project updates, HR documents). It always
// sanitizes, even when the server already did, and owns the only typography
// for rendered HTML so every module reads the same.
const props = withDefaults(defineProps<{
  html: string | null | undefined
  /** `sm` for previews inside cards and lists. */
  size?: 'sm' | 'md'
  tag?: 'div' | 'span'
}>(), { size: 'md', tag: 'div' })

const rendered = computed(() => sanitizeHtml(props.html ?? ''))
</script>

<template>
  <component :is="tag" class="rich-text-content" :class="size === 'sm' ? 'text-sm' : 'text-base'" v-html="rendered" />
</template>
