<script setup lang="ts">
import type { ProjectStatus } from '@nasq/contracts'
import { projectStatusLabelKey } from '@/composables/projectStatus'

const props = defineProps<{ status: ProjectStatus | null }>()
const { t } = useI18n()
const tone = computed(() => props.status ?? 'neutral')
</script>

<template>
  <span class="nasq-ui-status-pill" :data-tone="tone" data-testid="project-status">{{ t(projectStatusLabelKey(status)) }}</span>
</template>
