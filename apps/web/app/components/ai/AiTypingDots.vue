<script setup lang="ts">
// Three dots while the assistant answers; they stand still under reduced motion.
const { t } = useI18n()
</script>

<template>
  <span role="status" :aria-label="t('ai.thread.thinking')" class="inline-flex items-center gap-1 py-2" data-testid="ai-typing">
    <span v-for="delay in ['0ms', '150ms', '300ms']" :key="delay" aria-hidden="true" class="size-1.5 rounded-full bg-muted motion-safe:animate-pulse" :style="{ animationDelay: delay }" />
  </span>
</template>
