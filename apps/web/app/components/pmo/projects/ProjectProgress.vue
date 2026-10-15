<script setup lang="ts">
const props = withDefaults(defineProps<{ progress: number; taskCount: number; closedTaskCount: number; compact?: boolean }>(), { compact: false })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2" :title="t('projects.progressOf', { closed: closedTaskCount, total: taskCount }, taskCount)">
    <UProgress :model-value="progress" class="h-2 w-24" size="sm" />
    <span class="text-xs tabular-nums text-muted" data-testid="project-progress">{{ progress }}%</span>
    <span v-if="!compact" class="text-xs text-muted">{{ t('projects.progressOf', { closed: closedTaskCount, total: taskCount }, taskCount) }}</span>
  </div>
</template>
