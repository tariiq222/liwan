<script setup lang="ts">
// The Sadu dots while the assistant answers; they stand still under reduced motion.
const { t } = useI18n()
</script>

<template>
  <span class="inline-flex py-2" data-testid="ai-typing">
    <SharedSaduLoader variant="dots" :label="t('ai.thread.thinking')" />
  </span>
</template>
