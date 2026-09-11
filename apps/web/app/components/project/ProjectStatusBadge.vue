<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUS_TONE, projectStatusLabelKey } from '@/composables/projectStatus'
import { TONE_BADGE_COLOR } from '@/components/project/projectTone'

const props = defineProps<{ status: ProjectStatus | null }>()
const { t } = useI18n()
const color = computed(() => TONE_BADGE_COLOR[props.status ? PROJECT_STATUS_TONE[props.status] : 'neutral'])
</script>

<template>
  <UBadge variant="subtle" :color="color" data-testid="project-status">{{ t(projectStatusLabelKey(status)) }}</UBadge>
</template>
