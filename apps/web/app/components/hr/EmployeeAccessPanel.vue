<script setup lang="ts">
import type { HrEmployee } from '@nasq/contracts'
import AccessBadge from './AccessBadge.vue'

const props = defineProps<{ employee: HrEmployee }>()
const { can } = useAccess()
const route = useRoute()
const accountTo = computed(() => {
  const employee = props.employee
  if (!employee.user_id) return '/settings/users'
  const returnQuery = `returnTo=${encodeURIComponent(route.fullPath)}`
  return employee.access?.active ? `/settings/users/${employee.user_id}?${returnQuery}` : `/settings/users/new?employee_id=${employee.id}&${returnQuery}`
})
</script>

<template>
  <UCard v-if="can('hr.employees.access_status.read')">
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-sm text-muted">{{ $t('hr.employee.account') }}</span>
        <AccessBadge :access="employee.access" />
      </div>
      <p class="text-sm text-muted">{{ $t('hr.employee.accessManagedInSettings') }}</p>
      <UButton
        v-if="employee.user_id && can('access.users.read')"
        color="secondary"
        variant="solid"
        :to="accountTo"
        :label="$t('hr.employee.manageAccount')"
      />
    </div>
  </UCard>
</template>
