<script setup lang="ts">
import type { HrEmployee } from '@nasq/contracts'

const props = defineProps<{ access: HrEmployee['access'] }>()
const { t } = useI18n()
function hrAccessLabelKey(employee: Pick<HrEmployee, 'access'>): string {
  const access = employee.access
  if (!access) return 'hr.directory.access.noAccount'
  if (!access.active) return 'hr.directory.access.stopped'
  return `hr.directory.access.${access.role}`
}
const label = computed(() => t(hrAccessLabelKey({ access: props.access })))
</script>

<template>
  <UBadge color="neutral" variant="outline" data-testid="hr-access-badge">{{ label }}</UBadge>
</template>
