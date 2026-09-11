<script setup lang="ts">
import type { HrEmployee } from '@nasq/contracts'
import { hrAccessLabelKey } from '@/composables/hrAccess'

const props = defineProps<{ access: HrEmployee['access'] }>()
const { t } = useI18n()
const label = computed(() => t(hrAccessLabelKey({ access: props.access })))
</script>

<template>
  <UBadge color="neutral" variant="outline" data-testid="hr-access-badge">{{ label }}</UBadge>
</template>
