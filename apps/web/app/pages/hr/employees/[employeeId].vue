<script setup lang="ts">
import { owningListBack, recordChildTo, EMPLOYEE_LIST_PATHS } from '@/utils/recordListOrigin'
import EmployeeCard from '@/components/hr/EmployeeCard.vue'
import EmployeeProperties from '@/components/hr/EmployeeProperties.vue'
import { useArchiveHrEmployee, useHrEmployee, useUnarchiveHrEmployee } from '@/composables/useHrEmployees'
const route = useRoute(); const { t } = useI18n(); const { can } = useAccess(); const hydrated = useHydrated()
const id = computed(() => Number(route.params.employeeId))
const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
const isDetail = computed(() => route.path === `/hr/employees/${route.params.employeeId}`)
const query = useHrEmployee(computed(() => isDetail.value && validId.value ? id.value : null))
// Invalid ids have no record to load and use the same not-found state as an unknown positive id.
const pageError = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))
const backTo = computed(() => owningListBack(route.query, EMPLOYEE_LIST_PATHS, route.hash))
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
</script>
<template>
  <SharedRecordPage
    v-if="isDetail"
    :title="query.data.value?.name || t('hr.employee.title')"
    :description="query.data.value?.job_title"
    :back-to="backTo"
    :loading="query.isLoading.value"
    :error="pageError"
    @retry="query.refetch"
  >
    <template v-if="query.data.value" #actions>
      <div class="flex flex-wrap items-center gap-2">
        <UButton v-if="can('hr.employees.manage')" color="primary" icon="i-lucide-pencil" :disabled="!hydrated" :to="recordChildTo(`/hr/employees/${id}/edit`, route.query, EMPLOYEE_LIST_PATHS, route.hash)" :label="t('app.edit')" @click="!hydrated && $event.preventDefault()" />
        <UButton v-if="query.data.value.user_id && can('access.users.read')" color="neutral" variant="outline" :disabled="!hydrated" :to="`/settings/users/${query.data.value.user_id}`" :label="t('hr.employee.manageAccount')" @click="!hydrated && $event.preventDefault()" />
        <div v-if="can('hr.employees.archive')" class="ms-1 border-s border-default ps-3">
        <UButton color="neutral" variant="ghost" :icon="query.data.value.active ? 'i-lucide-archive' : 'i-lucide-archive-restore'" :disabled="!hydrated || archivePending" :aria-expanded="confirmArchive" :label="query.data.value.active ? t('hr.employee.archive') : t('hr.employee.unarchive')" data-testid="hr-employee-archive" @click="confirmArchive = !confirmArchive" />
        </div>
      </div>
    </template>
    <SharedInlineConfirm
      v-if="query.data.value && confirmArchive"
      :color="query.data.value.active ? 'error' : 'primary'"
      :description="query.data.value.name"
      :title="t('hr.employee.archiveConfirm')"
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
