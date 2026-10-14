<script setup lang="ts">
import type { HrEmployee } from '@nasq/contracts'
import { hrAccessBadge } from '@/utils/hrAccessBadge'

// The employee record's main column: the overview (avatar and job line) and, for a reader who may see
// account status, the account block. The facts are EmployeeProperties (the aside). The page owns the
// query, so this takes the loaded employee.
defineProps<{ employee: HrEmployee }>()
const { t } = useI18n()
const { can } = useAccess()
const canSeeAccess = computed(() => can('hr.employees.access_status.read'))
</script>

<template>
  <SharedRecordSection :title="t('hr.card.overview')">
    <div class="flex items-center gap-3 rounded-lg bg-default p-4 ring ring-default">
      <img
        :src="`/web/image/hr.employee/${employee.id}/avatar_128`"
        :alt="employee.name"
        class="size-11 rounded-full bg-elevated object-cover"
      >
      <p class="truncate text-sm text-muted">{{ employee.job_title || '—' }}</p>
    </div>
  </SharedRecordSection>
  <SharedRecordSection v-if="canSeeAccess" :title="t('hr.card.account')">
    <div class="space-y-3 rounded-lg bg-default p-4 ring ring-default">
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="text-muted">{{ t('hr.card.account') }}</span>
        <SharedStatusBadge variant="outline" data-testid="hr-access-badge" :tone="hrAccessBadge(employee.access).tone" :label="t(hrAccessBadge(employee.access).labelKey)" />
      </div>
      <p class="text-xs leading-5 text-muted">{{ t('hr.employee.accessManagedInSettings') }}</p>
    </div>
  </SharedRecordSection>
</template>
