<script setup lang="ts">
// A muted info icon after a task's title: hover, focus or tap shows the description's first line in a tooltip.
// Renders nothing for a task without a description. The click is stopped so it never opens the row's link.
defineProps<{ excerpt: string }>()
const { t } = useI18n()
const open = ref(false)
</script>

<template>
  <UTooltip v-if="excerpt" v-model:open="open" :text="excerpt" :ui="{ content: 'h-auto max-w-80 py-1.5', text: 'whitespace-normal break-words text-start' }">
    <button
      type="button"
      class="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:text-default focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none"
      :aria-label="t('tasks.descriptionHint')"
      data-testid="task-description-hint"
      @click.prevent.stop="open = !open"
    >
      <UIcon name="i-lucide-info" class="size-4" aria-hidden="true" />
    </button>
  </UTooltip>
</template>
