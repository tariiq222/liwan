<script setup lang="ts">
import type { HrEmployee } from '@liwan/contracts'

// The employee record's main column: the identity hero (avatar, name, job line; the status is a tag in the page heading).
// The facts, the account status and compensation sit in the page's aside. The page owns the query, so this takes the loaded employee.
defineProps<{ employee: HrEmployee }>()
</script>

<template>
  <SharedIdentityCard :id="employee.id" :name="employee.name" :subtitle="[employee.job_title, employee.department?.name].filter(Boolean).join(' · ')" />
</template>
