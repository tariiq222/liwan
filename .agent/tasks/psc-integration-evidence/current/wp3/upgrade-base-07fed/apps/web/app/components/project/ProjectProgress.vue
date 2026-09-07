<script setup lang="ts">
import { Progress } from '@/components/ui/progress'

const props = withDefaults(defineProps<{ progress: number; taskCount: number; closedTaskCount: number; compact?: boolean }>(), { compact: false })
const { t } = useI18n()
</script>

<template>
  <div class="flex items-center gap-2" :title="t('projects.progressOf', { closed: closedTaskCount, total: taskCount })">
    <Progress :model-value="progress" class="h-2 w-24" />
    <span class="text-xs tabular-nums text-muted-foreground" data-testid="project-progress">{{ progress }}%</span>
    <span v-if="!compact" class="text-xs text-muted-foreground">{{ t('projects.progressOf', { closed: closedTaskCount, total: taskCount }) }}</span>
  </div>
</template>
