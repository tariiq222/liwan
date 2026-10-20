<script setup lang="ts">
import { owningListBack, recordChildTo } from '@/utils/recordListOrigin'
import { EMPLOYEE_LIST_PATHS } from '@/modules/hr/navigation'
import EmployeeCard from '@/components/hr/EmployeeCard.vue'
import EmployeeProperties from '@/components/hr/EmployeeProperties.vue'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import type { RowAction } from '@webvue/ui/app/components/shared/data/RowActions.vue'
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
const confirmArchive = ref(false)
const { mutateAsync: archive, isPending: archiving } = useArchiveHrEmployee()
const { mutateAsync: unarchive, isPending: unarchiving } = useUnarchiveHrEmployee()
const archivePending = computed(() => archiving.value || unarchiving.value)
async function toggleArchive() {
  if (!query.data.value || !hydrated.value) return
  if (query.data.value.active) await archive(query.data.value.id)
  else await unarchive(query.data.value.id)
  confirmArchive.value = false
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
      onSelect: () => { confirmArchive.value = !confirmArchive.value },
    } satisfies RowAction] : []),
  ]
})
</script>
<template>
  <SharedRecordPage :keep-content="!!query.data.value"
    v-if="isDetail"
    :title="query.data.value?.name || t('hr.employee.title')"
    :description="query.data.value?.job_title"
    :tags="headerTags"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="query.data.value" #actions>
      <UButton v-if="can('hr.employees.manage')" color="primary" icon="i-lucide-pencil" :disabled="!hydrated" :to="recordChildTo(`/hr/employees/${id}/edit`, route.query, sourcePaths, route.hash)" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
      <SharedRowActions :actions="menuActions" :label="t('hr.directory.rowActions', { name: query.data.value.name })" :disabled="archivePending" />
    </template>
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
    <template v-if="query.data.value" #aside>
      <EmployeeProperties :employee="query.data.value" />
    </template>
  </SharedRecordPage>
  <NuxtPage v-else />
</template>
