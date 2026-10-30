<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { EMPLOYEE_LIST_PATHS } from '@/modules/hr/navigation'
import EmployeeCard from '@/components/hr/EmployeeCard.vue'
import EmployeeProperties from '@/components/hr/EmployeeProperties.vue'
import CompensationSection from '@/components/hr/payroll/CompensationSection.vue'
import type { PageHeaderTag } from '@liwan/ui/app/utils/pageHeaderTag'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { useHrCompensation } from '@/composables/useHrPayrollCompensation'
import { useArchiveHrEmployee, useHrEmployee, useUnarchiveHrEmployee } from '@/composables/useHrEmployees'
const route = useRoute()
const sourcePaths = useRecordListPaths(EMPLOYEE_LIST_PATHS); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.employeeId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const isDetail = computed(() => route.path === `/hr/employees/${route.params.employeeId}`)
const query = useHrEmployee(computed(() => isDetail.value && validId.value ? id.value : null))
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, sourcePaths.value, route.hash))
// Compensation is payroll data: it is neither fetched nor shown without `hr.payroll.read` (which carries the `hr.payroll` sub-feature gate).
const canReadCompensation = computed(() => can('hr.payroll.read'))
const compensation = useHrCompensation(computed(() => isDetail.value && validId.value ? id.value : 0))
const confirmArchive = ref(false)
const { mutateAsync: archive, isPending: archiving, error: archiveError, reset: resetArchive } = useArchiveHrEmployee()
// The server names the first exit blocker (departure, custody, settlement); show it inline, never in a dialog.
const EXIT_BLOCKERS = new Set(['departure_missing', 'custody_open', 'settlement_missing'])
const exitBlocker = computed(() => archiveError.value instanceof ApiError && EXIT_BLOCKERS.has(archiveError.value.code) ? archiveError.value.code : null)
const { mutateAsync: unarchive, isPending: unarchiving } = useUnarchiveHrEmployee()
const archivePending = computed(() => archiving.value || unarchiving.value)
async function toggleArchive() {
  if (!query.data.value || !hydrated.value) return
  try {
    if (query.data.value.active) await archive(query.data.value.id)
    else await unarchive(query.data.value.id)
    confirmArchive.value = false
  } catch (error) {
    if (!exitBlocker.value) throw error
    confirmArchive.value = false
  }
}
const headerTags = computed(() => query.data.value
  ? [{ label: t(query.data.value.active ? 'hr.directory.status.active' : 'hr.directory.status.archived'), tone: query.data.value.active ? 'success' : 'neutral' } satisfies PageHeaderTag]
  : [])
// Edit is the page's one primary action; the account link and archive sit in the overflow menu, the destructive one last.
const menuActions = computed<RowAction[]>(() => {
  const employee = query.data.value
  if (!employee) return []
  return [
    ...(employee.user_id && can('access.users.read') ? [{ label: t('hr.employee.manageAccount'), icon: 'i-lucide-user-cog', to: `/settings/team/users/${employee.user_id}` } satisfies RowAction] : []),
    ...(can('hr.employees.archive') ? [{
      label: employee.active ? t('hr.employee.archive') : t('hr.employee.unarchive'),
      icon: employee.active ? 'i-lucide-archive' : 'i-lucide-archive-restore',
      destructive: employee.active,
      onSelect: () => { resetArchive(); confirmArchive.value = !confirmArchive.value },
    } satisfies RowAction] : []),
  ]
})
</script>
<template>
  <SharedRecordPage :keep-content="!!query.data.value"
    v-if="isDetail"
    :title="query.data.value?.name || t('hr.employee.title')"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="query.data.value" #actions>
      <UButton v-if="can('hr.employees.manage')" color="primary" icon="i-lucide-pencil" :disabled="!hydrated" :to="recordChildTo(`/hr/employees/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
      <UButton v-if="!query.data.value.user_id && can('access.users.grant')" color="neutral" variant="outline" icon="i-lucide-key-round" :disabled="!hydrated" :to="recordChildTo(`/hr/employees/${id}/access`, route.query, sourcePaths, route.hash)" :label="t('hr.employee.grantAccess')" data-testid="hr-employee-grant-access" @click="!hydrated && $event.preventDefault()" />
      <SharedRowActions :actions="menuActions" :label="t('hr.directory.rowActions', { name: query.data.value.name })" :disabled="archivePending" />
    </template>
    <UAlert
      v-if="query.data.value && exitBlocker"
      role="alert"
      color="warning"
      variant="subtle"
      :title="t('hr.employee.exitBlocked.title')"
      :description="t(`hr.employee.exitBlocked.${exitBlocker}`)"
      data-testid="hr-employee-exit-blocker"
    />
    <SharedInlineConfirm
      v-if="query.data.value && confirmArchive"
      :color="query.data.value.active ? 'error' : 'primary'"
      :title="t(query.data.value.active ? 'hr.employee.archiveConfirm' : 'hr.employee.unarchiveConfirm', { name: query.data.value.name })"
      :confirm-label="query.data.value.active ? t('hr.employee.archive') : t('hr.employee.unarchive')"
      :pending="archivePending"
      @confirm="toggleArchive"
      @cancel="confirmArchive = false"
    />
    <EmployeeCard v-if="query.data.value" :employee="query.data.value" />
    <SharedPageState v-if="query.data.value && canReadCompensation" :loading="compensation.isLoading.value" :error="compensation.error.value" :keep-content="compensation.data.value !== undefined" @retry="compensation.refetch">
      <CompensationSection :compensation="compensation.data.value ?? null" :can-manage="can('hr.payroll.manage')" :edit-to="recordChildTo(`/hr/employees/${id}/compensation`, route.query, sourcePaths, route.hash)" />
    </SharedPageState>
    <template v-if="query.data.value" #aside>
      <EmployeeProperties :employee="query.data.value" />
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
