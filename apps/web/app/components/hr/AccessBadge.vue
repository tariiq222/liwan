<script setup lang="ts">
import type { HrEmployee } from '@nasq/contracts'
import { hrAccessLabelKey } from '@/composables/hrAccess'
import { accessTone } from '@/utils/statusTone'

const props = defineProps<{ access: HrEmployee['access'] }>()
const { t } = useI18n()
const label = computed(() => t(hrAccessLabelKey({ access: props.access })))
const tone = computed(() => accessTone(props.access?.active ?? null))
</script>

<template>
  <span class="nasq-ui-status-pill" :data-tone="tone" data-testid="hr-access-badge">{{ label }}</span>
</template>
