<script setup lang="ts">
const props = withDefaults(defineProps<{ progress: number; taskCount: number; closedTaskCount: number; compact?: boolean }>(), { compact: false })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2" :title="t('projects.progressOf', { closed: closedTaskCount, total: taskCount })">
    <UProgress :model-value="progress" :style="{ '--nasq-ui-progress': `${Math.min(100, Math.max(0, progress))}%` }" class="nasq-ui-progress h-2 w-24" size="sm" />
    <span class="text-xs tabular-nums text-muted" data-testid="project-progress">{{ progress }}%</span>
    <span v-if="!compact" class="text-xs text-muted">{{ t('projects.progressOf', { closed: closedTaskCount, total: taskCount }) }}</span>
  </div>
</template>
