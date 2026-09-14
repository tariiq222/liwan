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
  <component :is="tag" class="nasq-rich-text" :class="size === 'sm' ? 'text-sm' : 'text-base'" v-html="rendered" />
</template>

<style scoped>
.nasq-rich-text { min-width: 0; overflow-wrap: anywhere; line-height: 1.75; color: var(--ui-text); }
.nasq-rich-text :deep(:where(p, ul, ol, blockquote, pre)) { margin-block: 0 0.75em; }
.nasq-rich-text :deep(:where(p, ul, ol, blockquote, pre):last-child) { margin-block-end: 0; }
.nasq-rich-text :deep(ul) { list-style: disc; padding-inline-start: 1.5em; }
.nasq-rich-text :deep(ol) { list-style: decimal; padding-inline-start: 1.5em; }
.nasq-rich-text :deep(li + li) { margin-block-start: 0.25em; }
.nasq-rich-text :deep(:where(h1, h2, h3, h4, h5, h6)) { margin-block: 0.75em 0.35em; font-weight: 600; line-height: 1.5; color: var(--ui-text-highlighted); }
.nasq-rich-text :deep(:where(h1, h2, h3, h4, h5, h6):first-child) { margin-block-start: 0; }
.nasq-rich-text :deep(h1) { font-size: 1.25em; }
.nasq-rich-text :deep(h2) { font-size: 1.125em; }
.nasq-rich-text :deep(:where(h3, h4, h5, h6)) { font-size: 1em; }
.nasq-rich-text :deep(blockquote) { border-inline-start: 3px solid var(--ui-border); padding-inline-start: 0.75em; color: var(--ui-text-muted); }
.nasq-rich-text :deep(pre) { overflow-x: auto; border-radius: var(--ui-radius); background: var(--ui-bg-muted); padding: 0.625em; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.875em; }
.nasq-rich-text :deep(code) { border-radius: calc(var(--ui-radius) / 2); background: var(--ui-bg-muted); padding-inline: 0.25em; }
.nasq-rich-text :deep(a) { color: var(--brand-link); text-decoration: underline; text-underline-offset: 2px; }
.nasq-rich-text :deep(img) { max-width: 100%; height: auto; }
</style>
