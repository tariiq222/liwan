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
  <section v-if="can('hr.employees.access_status.read')" class="grid gap-3 rounded-lg border border-border/80 bg-muted/20 p-4">
    <div class="flex items-center justify-between">
      <span class="text-sm text-muted-foreground">{{ $t('hr.employee.account') }}</span>
      <AccessBadge :access="employee.access" />
    </div>
    <p class="text-sm text-muted-foreground">{{ $t('hr.employee.accessManagedInSettings') }}</p>
    <NuxtLink
      v-if="employee.user_id && can('access.users.read')"
      class="text-sm underline"
      :to="accountTo"
    >
      {{ $t('hr.employee.manageAccount') }}
    </NuxtLink>
  </section>
</template>
