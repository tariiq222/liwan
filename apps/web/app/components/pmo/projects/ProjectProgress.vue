<script setup lang="ts">
import type { ProgressTone } from './projectHealth'

// A project's progress in a table cell: the shared slim bar and the percentage beside it.
defineProps<{ progress: number; taskCount: number; closedTaskCount: number; tone?: ProgressTone }>()
const { t } = useI18n()
</script>

<template>
  <div class="flex min-w-0 items-center gap-3" :title="t('projects.progressOf', { closed: closedTaskCount, total: taskCount }, taskCount)">
    <SharedProgress class="min-w-16 flex-1" :value="progress" :tone="tone" :label="t('projects.columns.progress')" />
    <span class="w-10 shrink-0 text-end text-sm tabular-nums text-muted" data-testid="project-progress">{{ progress }}%</span>
  </div>
</template>
