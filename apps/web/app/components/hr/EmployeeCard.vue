<script setup lang="ts">
import type { HrEmployee } from '@webvue/contracts'
import { hrAccessBadge } from '@/utils/hrAccessBadge'
import HrIdentityCard from '@/components/hr/HrIdentityCard.vue'

// The employee record's main column: the identity hero (avatar, name, status, job line) and, for a reader who may
// see account status, a tinted account block. The facts are EmployeeProperties (the aside). The page owns the query,
// so this takes the loaded employee.
defineProps<{ employee: HrEmployee }>()
const { t } = useI18n()
const { can } = useAccess()
const canSeeAccess = computed(() => can('hr.employees.access_status.read'))
</script>

<template>
  <HrIdentityCard :id="employee.id" :name="employee.name" :subtitle="[employee.job_title, employee.department?.name].filter(Boolean).join(' · ')">
    <template #badge>
      <SharedStatusBadge size="sm" :tone="employee.active ? 'success' : 'neutral'" :label="t(employee.active ? 'hr.directory.status.active' : 'hr.directory.status.archived')" />
    </template>
  </HrIdentityCard>
  <SharedRecordSection v-if="canSeeAccess" variant="tinted" :title="t('hr.card.account')">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-muted">{{ t('hr.employee.accessManagedInSettings') }}</p>
      <SharedStatusBadge data-testid="hr-access-badge" :tone="hrAccessBadge(employee.access).tone" :label="t(hrAccessBadge(employee.access).labelKey)" />
    </div>
  </SharedRecordSection>
</template>
