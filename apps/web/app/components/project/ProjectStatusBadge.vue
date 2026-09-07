<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { PROJECT_STATUS_TONE, projectStatusLabelKey } from '@/composables/projectStatus'
import { STATUS_CHIP_CLASS } from '@/utils/statusTone'

const props = defineProps<{ status: ProjectStatus | null }>()
const { t } = useI18n()
const cls = computed(() => (props.status ? STATUS_CHIP_CLASS[PROJECT_STATUS_TONE[props.status]] : STATUS_CHIP_CLASS.neutral))
</script>

<template>
  <Badge variant="outline" :class="cls" data-testid="project-status">{{ t(projectStatusLabelKey(status)) }}</Badge>
</template>
