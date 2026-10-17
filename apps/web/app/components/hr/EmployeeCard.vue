<script setup lang="ts">
import type { HrEmployee } from '@webvue/contracts'
import { hrAccessBadge } from '@/utils/hrAccessBadge'
import { avatarProps } from '@webvue/ui/app/utils/avatarTone'

// The employee record's main column: the overview (avatar, job line, department, manager and status) and,
// for a reader who may see account status, the account block. The contact facts are EmployeeProperties
// (the aside). The page owns the query, so this takes the loaded employee.
defineProps<{ employee: HrEmployee }>()
const { t } = useI18n()
const { can } = useAccess()
const canSeeAccess = computed(() => can('hr.employees.access_status.read'))
</script>

<template>
  <SharedRecordSection :title="t('hr.card.overview')">
    <div class="flex items-center gap-4 rounded-card bg-default p-4 ring ring-default">
      <UAvatar v-bind="avatarProps(employee.name, employee.id)" size="xl" />
      <div class="min-w-0 flex-1 space-y-1.5">
        <div class="flex flex-wrap items-center gap-2">
          <p class="truncate text-base font-semibold text-highlighted">{{ employee.name }}</p>
          <SharedStatusBadge size="sm" :tone="employee.active ? 'success' : 'neutral'" :label="t(employee.active ? 'hr.directory.status.active' : 'hr.directory.status.archived')" />
        </div>
        <p class="truncate text-sm text-muted">{{ [employee.job_title, employee.department?.name].filter(Boolean).join(' · ') }}</p>
        <p v-if="employee.manager" class="flex items-center gap-1.5 text-xs text-muted">
          <span>{{ t('hr.card.manager') }}</span>
          <UAvatar v-bind="avatarProps(employee.manager.name, employee.manager.id)" size="3xs" />
          <span class="truncate text-default">{{ employee.manager.name }}</span>
        </p>
      </div>
    </div>
  </SharedRecordSection>
  <SharedRecordSection v-if="canSeeAccess" :title="t('hr.card.account')">
    <div class="space-y-3 rounded-card bg-default p-4 ring ring-default">
      <div class="flex items-center justify-between gap-3 text-sm">
        <span class="text-muted">{{ t('hr.card.account') }}</span>
        <SharedStatusBadge data-testid="hr-access-badge" :tone="hrAccessBadge(employee.access).tone" :label="t(hrAccessBadge(employee.access).labelKey)" />
      </div>
      <p class="text-xs leading-5 text-muted">{{ t('hr.employee.accessManagedInSettings') }}</p>
    </div>
  </SharedRecordSection>
</template>
