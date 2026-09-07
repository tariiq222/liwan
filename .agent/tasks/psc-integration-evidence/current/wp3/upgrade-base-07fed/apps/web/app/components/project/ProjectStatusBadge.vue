<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUS_TONE, projectStatusLabelKey } from '@/composables/projectStatus'
import { TONE_CLASS } from '@/composables/taskState'

const props = defineProps<{ status: ProjectStatus | null }>()
const { t } = useI18n()
const cls = computed(() => (props.status ? TONE_CLASS[PROJECT_STATUS_TONE[props.status]] : TONE_CLASS.neutral))
</script>

<template>
  <Badge variant="outline" :class="cls" data-testid="project-status">{{ t(projectStatusLabelKey(status)) }}</Badge>
</template>
